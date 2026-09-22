#!/usr/bin/env python3
"""Optional real-Hermes integration. Pass --hermes /path/to/hermes.
Temporary home, installed package only. Synthetic lifecycle via real hook registry,
not an LLM session and not the user's live runtime. Requires Hermes installed.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import shutil
import subprocess
import tempfile
import urllib.request

parser=argparse.ArgumentParser()
parser.add_argument('--hermes',default='hermes')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='town-native-hermes-') as tmp:
    home=Path(tmp)
    env={k:v for k,v in os.environ.items() if not k.startswith('HERMES_TOWN_')}
    env['HERMES_HOME']=str(home)
    env['PYTHONDONTWRITEBYTECODE']='1'
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    env['HERMES_TOWN_BRIDGE_URL']=f'http://127.0.0.1:{port}/api/town/ingest'
    def command(argv):
        p=subprocess.run(argv,env=env,cwd=tmp,text=True,capture_output=True,timeout=45)
        if p.returncode: raise AssertionError(f'{argv}: {p.returncode}\n{p.stdout}\n{p.stderr}')
        return p.stdout
    def town(*words): return command([args.hermes,'town',*words])
    command(['node',str(root/'scripts/install-hermes-town-plugin.mjs'),'--hermes-home',str(home)])
    command([args.hermes,'plugins','enable','hermes-town','--no-allow-tool-override'])
    installed=home/'plugins/hermes-town'
    assert (installed/'runtime/dist/index.html').is_file()
    assert not (installed/'node_modules').exists()
    before=json.loads(town('status','--json'))
    assert before['bundleReady'] and not before['managedByThisProfile']
    try:
        town('start')
        ready=json.loads(town('status','--json'))
        assert ready['serverHealthy'] and ready['managedByThisProfile'] and ready['firstEventsObserved'] is False
        first=(home/'hermes-town/runtime/server.json').read_bytes()
        town('start')
        assert (home/'hermes-town/runtime/server.json').read_bytes()==first
        # Execute through Hermes's own interpreter, discovered from its console script.
        executable=Path(shutil.which(args.hermes) or args.hermes).resolve()
        if executable.suffix.lower() == '.exe':
            python=str(executable.parent/'python.exe')
        else:
            shebang=executable.read_text().splitlines()[0]
            python=shebang[2:] if shebang.startswith('#!/') else str(executable.parent/'python')
        code='''import json,time,urllib.request
from hermes_cli.plugins import get_plugin_manager
m=get_plugin_manager();m.discover_and_load()
sid="HT_NATIVE_PRIVATE_SENTINEL"
m.invoke_hook("on_session_start",session_id=sid)
m.invoke_hook("pre_tool_call",session_id=sid,tool_name="read_file",args={"path":"HT_NATIVE_PRIVATE_SENTINEL"})
end=time.monotonic()+5
while time.monotonic()<end:
 with urllib.request.urlopen("http://127.0.0.1:PORT/api/town/health") as r: h=json.load(r)
 if h.get("bridge",{}).get("receivedEvents",0)>=2: break
 time.sleep(.05)
assert h["bridge"]["receivedEvents"]>=2,h
print(json.dumps({"registryDelivery":True,"receivedEvents":h["bridge"]["receivedEvents"]}))
'''.replace('PORT',str(port))
        delivery=json.loads(command([python,'-c',code]).strip().splitlines()[-1])
        after=json.loads(town('status','--json'))
        assert after['firstEventsObserved'] is True
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f'http://127.0.0.1:{port}/') as response:
            assert b'Hermes Town' in response.read()
        with opener.open(f'http://127.0.0.1:{port}/api/town/snapshot') as response:
            public=response.read().decode()
        token=(home/'hermes-town/runtime/bridge-token').read_text().strip()
        management=json.loads(first)['managementToken']
        for secret in ('HT_NATIVE_PRIVATE_SENTINEL',token,management,str(home)): assert secret not in public
        town('stop')
        final=json.loads(town('status','--json'))
        assert not final['serverReachable']
        print(json.dumps({'ok':True,'nativeCLI':True,'isolatedInstalledPackage':True,'idempotentStart':True,'syntheticLifecycleThroughHermesRegistry':delivery,'firstEventTransition':True,'privateSentinelAbsent':True,'authenticatedStop':True}))
    finally:
        subprocess.run([args.hermes,'town','stop'],env=env,cwd=tmp,capture_output=True,timeout=30)
