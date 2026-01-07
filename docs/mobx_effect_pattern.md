# MobX Post-Render Effect Pattern

This pattern allows MobX actions to schedule side effects (like DOM manipulation or focus management) that need to run after the next React render cycle.

## The Problem
MobX actions update state, which triggers a React re-render. However, you often need to perform DOM operations (like focusing an input) *after* that re-render has completed and the new DOM elements are in place.

## The Solution
1.  **Base Class**: `EffectAwareModel` maintains the effect queue.
2.  **Hook**: `useScheduledEffects` consumes the queue after every render.

## Implementation Example

### 1. Store / Model

```typescript
import { observable, action } from 'mobx';
import { EffectAwareModel } from './EffectAwareModel';

export class MyModel extends EffectAwareModel {
    // Example Action
    @action
    enableEditing() {
        this.isEditing = true;
        // Schedule focus for after render
        this.scheduleEffect(() => {
            if (this.inputRef.current) {
                this.inputRef.current.focus();
            }
        });
    }
}
```

### 2. React Component

```tsx
import React from 'react';
import { observer } from 'mobx-react-lite';
import { useScheduledEffects } from '../hooks/useScheduledEffects';

export const MyComponent = observer(({ model }) => {
    // Run after every render
    useScheduledEffects(model);

    return (
        <div>
            {model.isEditing && (
                <input ref={model.inputRef} />
            )}
        </div>
    );
});
```

## How this works

`EffectAwareModel` is a base class for models that need to schedule side effects after a render. It maintains a queue of callbacks in `effectCallbacks` and provides a method `scheduleEffect` to add new callbacks to the queue. Calling `scheduleEffect` also ensures that the component that calls `useScheduledEffects` on this model will re-render.

`useScheduledEffects` is a React hook that consumes the queue of a model after every render (empty effect dependencies array). It is used in the component that needs to perform the side effect. It results in a call to `consumeEffects` on the model, which executes all callbacks in the queue and clears it.

