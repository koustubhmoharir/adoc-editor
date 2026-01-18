import { createRef, ReactNode, useEffect, useRef } from 'react';
import { closeOnClick, useUpDownFocusNavigationInPopover } from '../hooks/useFocusNavigation';
import * as styles from './Popovers.css';
import { action, observable } from 'mobx';
import { EffectAwareModel } from '../store/EffectAwareModel';
import { useScheduledEffects } from '../hooks/useScheduledEffects';
import { observer } from 'mobx-react-lite';

export interface ButtonMenuProps {
    children?: ReactNode;
    testid?: string;
}

class ButtonMenuModel extends EffectAwareModel {
    constructor() {
        super();
    }
    
    @observable private accessor _isOpen = false;
    get isOpen() { return this._isOpen; }
    
    private _button: HTMLButtonElement | null = null;
    readonly containerRef = createRef<HTMLDivElement>();

    initialize() {
        const container = this.containerRef.current;
        if (!container) return;
        this._button = container.closest('button');
        if (!this._button) return;
        this._button.addEventListener('click', this.onButtonClick);
    }

    @action.bound
    onButtonClick() {
        if (this._button) {
            this._button.style.setProperty('anchor-name', styles.anchorName);
            this._isOpen = true;
            this.scheduleEffect(() => {
                if (this.containerRef.current) {
                    this.containerRef.current.showPopover();
                }
            });
        }
    }

    @action.bound
    onClosed() {
        this._isOpen = false;
        if (this._button) {
            this._button.style.removeProperty('anchor-name');
        }
    }

    dispose() {
        if (this._button) {
            this._button.removeEventListener('click', this.onButtonClick);
            this._button = null;
        }
    }
}

export const ButtonMenu = observer((props: ButtonMenuProps) => {
    const modelRef = useRef<ButtonMenuModel>(null);
    const model = modelRef.current ?? (modelRef.current = new ButtonMenuModel());
    useEffect(() => {
        model.initialize();
        return () => {
            model.dispose();
        };
    }, []);
    useScheduledEffects(model);
    useUpDownFocusNavigationInPopover(model.containerRef, model.onClosed);
    return (
        <div
            ref={model.containerRef}
            className={styles.container}
            // @ts-ignore
            popover="auto"
            style={model.isOpen ? undefined : { display: 'none' }}
            tabIndex={-1} // Allow focus
            onClick={closeOnClick}
            data-testid={props.testid}
        >
            {props.children}
        </div>
    );
});