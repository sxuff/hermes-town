# Hermes Town

## Product thesis

Hermes Town is a spatial interface for persistent AI agents. Residents, buildings, motion, and visible world changes represent real work rather than fictional NPC activity. A glance should show what the runtime is doing.

## What the viewer should understand

- Each resident is one real Hermes execution context.
- Location and animation show the current class of work.
- Thinking, waiting, completion, failure, and departure are visually distinct.
- An empty runtime produces an empty town with an explicit disconnected or waiting state.
- Demo activity is always labeled as demo activity.

## Work vocabulary

| Place | Tools and events | Animation |
|---|---|---|
| Library | Read, search, file discovery | reading at a lectern |
| Workshop | Edit, write, patch | working at a bench |
| Forge | shell, tests, package commands | hammering at an anvil |
| Post office | git and GitHub | parcel at the post box |
| Observatory | web search and browser work | telescope |
| Town hall | delegation, planning, LLM turns | desk and thinking emote |
| Tavern | completed or idle work | resting |
| Market | unrecognized tools | market stall |
| Houses | departed sessions | returns home |

## System model

```text
Hermes lifecycle hooks or scripted demo
                 ↓
        allowlisted Town events
                 ↓
      resident simulation and paths
                 ↓
          Phaser town renderer
```

## Non-goals

Simulated social chatter, public live hosting, an economy, multiplayer, combat, infinite terrain, or direct browser access to Hermes control surfaces.

## Next milestones

1. Publish the packaged v0.3.0 release and submit its catalog pin for review. The bundled runtime and explicit `hermes town setup/start/status/stop/open` path are implemented; publication is separate.
2. Optional Hermes Desktop page or launcher after the local server lifecycle is packaged.
3. Waiting-for-user state with an explicit, privacy-safe lifecycle signal.
4. Day history and stable session-to-home continuity across restarts.
