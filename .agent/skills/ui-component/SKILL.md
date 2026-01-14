---
name: ui-component
description: Generates a React UI component following the project's MobX architecture and "dumb" component pattern.
---

# UI Component Construction

This skill guides the creation of React UI components that adhere to the project's strict architectural guidelines, specifically the "Dumb Component" philosophy and MobX Effect Pattern.

## 1. Architectural Rules

### "Dumb" Components
- **Role**: Components are purely for rendering state and binding user interactions to store actions.
- **State**: NO local state (`useState`, `useReducer`) for business logic. Local state is only permitted for purely transient UI interactions that never leave the component (e.g., a hover state that triggers no other logic), but even then, prefer MobX.
- **Logic**: NO business logic in components. All logic belongs in the MobX store.
- **Refs**: Do not manage DOM refs manually for logic. Store refs in `readonly` properties in the MobX model if they are needed for logic (e.g., focus management, scrolling). Create them with `createRef`.

### MobX Integration
- **Observer**: All components must be wrapped in `observer`.
- **Stores**: Import top-level stores directly (singleton pattern). Do not use React Context for core stores (`EditorStore`, `FileSystemStore`).
- **Effect Pattern**:
    - **NEVER** use `useEffect` for state management or reaction to model changes.
    - Use `EffectAwareModel` (base class) and `useScheduledEffects` (hook) for post-render side effects like focusing inputs.
    - `useEffect` is **only** allowed for:
        - Registering/unregistering 3rd party libraries that strictly require it.
        - Calling `initialize` / `dispose()` methods on a store when the component mounts or unmounts.

### Event Handling
- **No Inline Handlers**: Do not write inline logic like `onClick={() => store.doSomething()}`.
- **Bound Actions**: Define actions in the store using `@action.bound`.
- **Direct Binding**: Pass the bound action directly: `onClick={store.handleClick}`.

## 2. Store / Model Structure

- **Explicit Decorators**: Use local standard decorators.
    - `@observable accessor value`
    - `@computed get derived()`
    - `@action method()` or `@action.bound method()`
- **No Auto**: Do NOT use `makeAutoObservable(this)`.
- **Restrict accessibility**: Use object oriented features of TypeScript.
    - Use the `private` keyword along with an underscore prefix on the member name for fields, accessors, and helper methods wherever restricting accessibility is beneficial in preserving invariants of the model.
    - Fields that do not need to be set after model construction should be `readonly`.
    - Trivial accessors that are set from outside the model and do not require changes to other state maintained by the model when they are changed should be public.
    - Observable properties that only need to be read from outside the model should have a private accessor and should be exposed with a getter.
    - Non-trivial properties that need to be set from outside the model should have a private accessor and should be exposed with a getter marked as `@computed` and a setter that performs any other state updates. MobX automatically marks the setter as an action when its getter is computed.
- **Order of members**: Order members in the following order:
    - Constructor
    - Fields, accessors and getters / setters
    - Refs
    - Computed properties
    - Public methods and event handlers
    - Private methods

## 3. Styling & Assets

- **Vanilla Extract**: Use `.css.ts` files for styling.
    - Define style objects and export class names.
    - Import class names in the component.
- **Icons**: Use Font Awesome class names.
    - Format: `<i className="fa-solid fa-[icon-name]" />`
    - Do NOT import icon components.

## 4. Testing Requirements

- **Locators**: Every interactive element MUST have a `data-` attribute for consistent testing locators.
    - `data-testid="..."`
    - `data-action="..."`
    - `data-item-id="..."`

## 5. Implementation Template

### The Store (`src/store/MyFeatureStore.ts`)

```typescript
import { observable, action, computed } from 'mobx';
import { EffectAwareModel } from './EffectAwareModel';

export class MyFeatureStore extends EffectAwareModel { // Extend EffectAwareModel if we need to schedule effects. Not all models need this functionality.
    // Constructor at the top of the class

    constructor() { 
        super();
    }

    // Fields, accessors and getters / setters

    @observable accessor inputValue: string = ''; // public because it is trivial

    @observable private accessor _isVisible: boolean = false; // private because it does not need to be set from outside the model
    get isVisible() { // getter that exposes the private field should be immediately after it
        return this._isVisible;
    }
    

    // Refs

    // Hold ref in store if needed for logic
    readonly inputRef = React.createRef<HTMLInputElement>();

    // Computed properties

    @computed
    get isValid() {
        return this.inputValue.length > 0;
    }

    // Public methods and event handlers

    @action.bound
    handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (this.isValid) {
            // Logic here
            this._isVisible = false;
        }
    }

    @action.bound
    showInput() {
        this._isVisible = true;
        // Schedule DOM focus after render
        this.scheduleEffect(() => {
            this.inputRef.current?.focus();
        });
    }
}

export const myFeatureStore = new MyFeatureStore();
```

### The Component (`src/components/MyFeature.tsx`)

```tsx
import React from 'react';
import { observer } from 'mobx-react-lite';
import { myFeatureStore } from '../store/MyFeatureStore';
import { useScheduledEffects } from '../hooks/useScheduledEffects';
import * as styles from './MyFeature.css';

export const MyFeature = observer(() => {
    // Consume scheduled effects (focus, scroll, etc.)
    useScheduledEffects(myFeatureStore);

    if (!myFeatureStore.isVisible) {
        return null;
    }

    return (
        <div className={styles.container} data-testid="my-feature-container">
            <h1 className={styles.title}>Feature</h1>
            <input 
                ref={myFeatureStore.inputRef}
                value={myFeatureStore.inputValue}
                onChange={(e) => {myFeatureStore.inputValue = e.target.value}}
                data-testid="feature-input"
            />
            <button 
                onClick={myFeatureStore.handleSubmit}
                data-action="submit"
            >
                <i className="fa-solid fa-check" /> Submit
            </button>
        </div>
    );
});
```
