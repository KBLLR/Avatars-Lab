# MLX Conversation Lab - Architecture

## Overview

The Lab is a modular experimentation platform for multi-modal AI-avatar experiences. Every component is designed to be reusable, composable, and experiment-agnostic.

## Core Principles

1. **Cards are Modules** - Each card is a self-contained component with its own state, UI, and logic
2. **Event-Driven** - Cards communicate via a shared event bus, not direct references
3. **Tool-First** - AI agents can use tools; tool calls are first-class UI citizens
4. **Multi-Avatar** - The stage supports N avatars with routing and orchestration
5. **Experiment Agnostic** - Components work across different lab experiments

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         LAB SHELL                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     EVENT BUS                            │   │
│  │  (avatar:speak, tool:call, chat:message, stage:update)   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌───────────┬───────────────┼───────────────┬────────────┐    │
│  │           │               │               │            │    │
│  │  STAGE    │    CHAT       │    TOOLS      │  CONTROLS  │    │
│  │  MODULE   │    MODULE     │    MODULE     │  MODULE    │    │
│  │           │               │               │            │    │
│  │ ┌───────┐ │ ┌───────────┐ │ ┌───────────┐ │ ┌────────┐ │    │
│  │ │Avatar1│ │ │ Messages  │ │ │ Registry  │ │ │Session │ │    │
│  │ │Avatar2│ │ │ ToolCalls │ │ │ Execution │ │ │Voice   │ │    │
│  │ │Avatar3│ │ │ Input     │ │ │ Results   │ │ │Models  │ │    │
│  │ └───────┘ │ └───────────┘ │ └───────────┘ │ │Lights  │ │    │
│  │           │               │               │ │Camera  │ │    │
│  └───────────┴───────────────┴───────────────┴─┴────────┴─┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Modules

### Stage Module (`/src/lab/modules/stage/`)
- Multi-avatar rendering
- Stage layouts (single, split, grid, focus)
- Avatar state management
- Spotlight/lighting per avatar
- Speaking indicator

### Chat Module (`/src/lab/modules/chat/`)
- Message rendering (user, assistant, system)
- Tool call blocks (expandable)
- Typing indicators
- Voice input integration
- Multi-turn context

### Tools Module (`/src/lab/modules/tools/`)
- Tool registry (available tools)
- Tool call visualization
- Execution status
- Result rendering
- MCP integration

### Controls Module (`/src/lab/modules/controls/`)
- Card components (reusable)
- Session management
- Voice settings
- Model selection
- Lighting controls
- Camera controls

## Card Component API

Each card follows a standard interface:

```typescript
interface LabCard {
  id: string;
  title: string;
  collapsed: boolean;

  // Lifecycle
  init(bus: EventBus): void;
  destroy(): void;

  // State
  getState(): CardState;
  setState(state: Partial<CardState>): void;

  // Events
  on(event: string, handler: Function): void;
  emit(event: string, data: any): void;

  // Render
  render(): HTMLElement;
}
```

## Event Bus

Central communication layer:

```typescript
// Avatar events
bus.emit('avatar:add', { id, model, position })
bus.emit('avatar:remove', { id })
bus.emit('avatar:speak', { id, text, audio })
bus.emit('avatar:gesture', { id, gesture })
bus.emit('avatar:mood', { id, mood })

// Chat events
bus.emit('chat:message', { role, content, avatarId? })
bus.emit('chat:tool_call', { id, name, args })
bus.emit('chat:tool_result', { id, result })
bus.emit('chat:typing', { avatarId, active })

// Stage events
bus.emit('stage:layout', { mode: 'single' | 'split' | 'grid' })
bus.emit('stage:focus', { avatarId })
bus.emit('stage:light', { preset, avatarId? })

// Session events
bus.emit('session:start', { config })
bus.emit('session:end', {})
bus.emit('session:error', { error })

// Tool events
bus.emit('tool:register', { name, schema, handler })
bus.emit('tool:execute', { name, args })
bus.emit('tool:result', { name, result })
```

## Multi-Avatar Support

### Stage Layouts

```
SINGLE          SPLIT           GRID            FOCUS
┌─────────┐    ┌────┬────┐    ┌───┬───┬───┐   ┌─────────┐
│         │    │    │    │    │ 1 │ 2 │ 3 │   │    1    │
│    1    │    │ 1  │ 2  │    ├───┼───┼───┤   │  focus  │
│         │    │    │    │    │ 4 │ 5 │ 6 │   ├──┬──┬──┤
└─────────┘    └────┴────┘    └───┴───┴───┘   │2 │3 │4 │
                                               └──┴──┴──┘
```

### Avatar Routing

```typescript
interface AvatarRoute {
  from: string;      // Avatar ID or 'user'
  to: string[];      // Target avatar IDs
  mode: 'broadcast' | 'direct' | 'round-robin';
}

// Example: User speaks to Avatar 1, who responds and can speak to Avatar 2
const routes: AvatarRoute[] = [
  { from: 'user', to: ['avatar-1'], mode: 'direct' },
  { from: 'avatar-1', to: ['user', 'avatar-2'], mode: 'broadcast' }
];
```

## Tool Integration

### Tool Definition

```typescript
interface LabTool {
  name: string;
  description: string;
  parameters: JSONSchema;

  // Execution
  execute(args: any): Promise<ToolResult>;

  // UI
  renderCall(args: any): HTMLElement;
  renderResult(result: any): HTMLElement;
}
```

### Built-in Tools

- `web_search` - Search the web
- `read_file` - Read local files
- `generate_image` - Call mflux for image generation
- `play_audio` - Play audio files
- `set_mood` - Change avatar mood
- `set_lighting` - Change stage lighting
- `speak` - Make avatar speak

### MCP Integration

```typescript
// Connect to MCP servers
await lab.connectMCP('filesystem', { root: '/path' });
await lab.connectMCP('web', { allowed_domains: [...] });

// Tools are automatically registered from MCP
bus.on('mcp:tools_updated', (tools) => {
  toolRegistry.update(tools);
});
```

## File Structure

```
src/lab/
├── index.ts              # Lab shell & bootstrap
├── event-bus.ts          # Central event bus
├── types.ts              # Shared types
│
├── modules/
│   ├── stage/
│   │   ├── index.ts      # Stage module
│   │   ├── avatar.ts     # Avatar instance
│   │   ├── layouts.ts    # Layout modes
│   │   └── lighting.ts   # Per-avatar lighting
│   │
│   ├── chat/
│   │   ├── index.ts      # Chat module
│   │   ├── message.ts    # Message component
│   │   ├── tool-call.ts  # Tool call block
│   │   └── input.ts      # Voice/text input
│   │
│   ├── tools/
│   │   ├── index.ts      # Tools module
│   │   ├── registry.ts   # Tool registry
│   │   ├── executor.ts   # Tool execution
│   │   └── builtin/      # Built-in tools
│   │
│   └── controls/
│       ├── index.ts      # Controls module
│       └── cards/        # Reusable cards
│           ├── session.ts
│           ├── avatar.ts
│           ├── voice.ts
│           ├── models.ts
│           ├── lighting.ts
│           ├── camera.ts
│           └── tools.ts
│
├── cards/
│   ├── base-card.ts      # Base card class
│   └── card-registry.ts  # Card type registry
│
└── experiments/
    ├── conversation.ts   # Single avatar chat
    ├── debate.ts         # Multi-avatar debate
    ├── interview.ts      # Interview format
    └── presentation.ts   # Avatar presentation
```

## Usage

### Basic Experiment

```typescript
import { createLab } from './lab';
import { SessionCard, AvatarCard, VoiceCard } from './lab/modules/controls/cards';

const lab = createLab({
  stage: { layout: 'single' },
  avatars: [{ id: 'host', model: 'avatar-1.glb' }],
  tools: ['web_search', 'generate_image'],
  cards: [SessionCard, AvatarCard, VoiceCard]
});

lab.mount('#app');
lab.start();
```

### Multi-Avatar Debate

```typescript
const lab = createLab({
  stage: { layout: 'split' },
  avatars: [
    { id: 'pro', model: 'avatar-1.glb', position: 'left' },
    { id: 'con', model: 'avatar-2.glb', position: 'right' }
  ],
  routing: [
    { from: 'user', to: ['pro', 'con'], mode: 'broadcast' },
    { from: 'pro', to: ['con'], mode: 'direct' },
    { from: 'con', to: ['pro'], mode: 'direct' }
  ],
  systemPrompts: {
    pro: 'You argue FOR the topic...',
    con: 'You argue AGAINST the topic...'
  }
});
```

## CSS Variables

All lab components use these CSS variables for consistent styling:

```css
:root {
  /* Layout */
  --lab-margin: 16px;
  --lab-gutter: 16px;
  --lab-radius: 12px;

  /* Colors */
  --lab-bg: #09090b;
  --lab-fg: #fafafa;
  --lab-muted: #a1a1aa;
  --lab-border: #27272a;
  --lab-surface: #18181b;
  --lab-hover: #27272a;

  /* Accents */
  --lab-accent: #f97316;
  --lab-success: #22c55e;
  --lab-warning: #eab308;
  --lab-error: #ef4444;

  /* Typography */
  --lab-font: 'Inter', sans-serif;
  --lab-font-mono: 'JetBrains Mono', monospace;
}
```
