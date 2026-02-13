import React, { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import * as styles from './Dialog.css';
import { observable, action } from "mobx";
import { appName } from "../store/ThemeStore";
import { useLeftRightFocusNavigation } from '../hooks/useFocusNavigation';
import { traceLog } from '../utils/trace';

type DialogType = 'alert' | 'confirm' | 'input';

export interface AlertOptions {
    title?: string;
    icon?: 'error' | 'warning' | 'info';
    okText?: string;
}

export interface ConfirmOptions {
    title?: string;
    yesText?: string;
    noText?: string;
    showCancel?: boolean;
    cancelText?: string;
}

export interface InputOptions {
    title?: string;
    okText?: string;
    cancelText?: string;
}

export interface InputFieldDef {
    displayName: string;
    type: 'string';
}

export interface Dialog {
    readonly isOpen: boolean;
    readonly defaultTitle: string;
    alert(message: string, options?: AlertOptions): Promise<void>;
    confirm(message: string, options?: ConfirmOptions): Promise<boolean | null>;
    input(fieldDefs: Record<string, InputFieldDef>, options?: InputOptions): Promise<Record<string, string> | null>;
}

class DialogStore implements Dialog {
    readonly defaultTitle = appName;
    @observable accessor type: DialogType = 'alert';
    @observable accessor message: string = '';
    @observable accessor title: string = '';

    // Alert specific
    @observable accessor alertIcon: 'error' | 'warning' | 'info' | undefined = undefined;
    @observable accessor okText: string = 'OK';

    // Confirm specific
    @observable accessor yesText: string = 'OK';
    @observable accessor noText: string = 'Cancel';
    @observable accessor showCancel: boolean = false;
    @observable accessor cancelText: string = 'Cancel';

    // Input specific
    @observable accessor fieldDefs: Record<string, { displayName: string, type: 'string' }> = {};
    @observable accessor inputValues: Record<string, string> = {};

    dialogRef: React.RefObject<HTMLDialogElement | null> = React.createRef();
    confirmButtonRef: React.RefObject<HTMLButtonElement | null> = React.createRef();
    private resolvePromise: ((value: any) => void) | null = null;
    private pendingResult: any = undefined;
    get isOpen() { return this.dialogRef.current?.open ?? false; }

    @action
    private show(type: DialogType, messageOrFields: string | Record<string, any>, options: AlertOptions | ConfirmOptions | InputOptions = {}): Promise<any> {
        traceLog('DialogStore.show', { type, messageOrFields, options });
        this.type = type;

        if (type === 'input') {
            this.fieldDefs = messageOrFields as Record<string, { displayName: string, type: 'string' }>;
            this.inputValues = Object.keys(this.fieldDefs).reduce((acc, key) => {
                acc[key] = ''; // Initialize with empty string
                return acc;
            }, {} as Record<string, string>);
            this.message = ''; // No message for input usually, or pass in options?
            // Requirement says: "dialog.input(fieldDefs, options)"
            // So we don't have a message param for input.
        } else {
            // TODO: Convert any new lines in the message to <br/>
            this.message = messageOrFields as string;
        }

        this.title = options.title || appName;
        this.pendingResult = undefined;

        if (type === 'alert') {
            const opts = options as AlertOptions;
            this.alertIcon = opts.icon;
            this.okText = opts.okText || 'OK';
        } else if (type === 'confirm') {
            const opts = options as ConfirmOptions;
            this.yesText = opts.yesText || 'Yes';
            this.noText = opts.noText || 'No';
            this.showCancel = opts.showCancel || false;
            this.cancelText = opts.cancelText || 'Cancel';
        } else if (type === 'input') {
            const opts = options as InputOptions;
            this.okText = opts.okText || 'OK';
            this.cancelText = opts.cancelText || 'Cancel';
        }

        if (this.dialogRef.current) {
            this.dialogRef.current.showModal();
        }

        if (this.confirmButtonRef.current) {
            this.confirmButtonRef.current.focus();
        }

        return new Promise((resolve) => {
            this.resolvePromise = resolve;
        });
    }

    @action
    private close() {
        traceLog('DialogStore.close');
        if (this.dialogRef.current && this.dialogRef.current.open) {
            this.dialogRef.current.close();
        }
    }

    @action
    alert(message: string, options?: AlertOptions): Promise<void> {
        traceLog('DialogStore.alert', message);
        return this.show('alert', message, options);
    }

    @action
    confirm(message: string, options?: ConfirmOptions): Promise<boolean | null> {
        traceLog('DialogStore.confirm', message);
        return this.show('confirm', message, options);
    }

    @action
    input(fieldDefs: Record<string, InputFieldDef>, options?: InputOptions): Promise<Record<string, string> | null> {
        traceLog('DialogStore.input', fieldDefs);
        return this.show('input', fieldDefs, options);
    }

    @action
    handleInputChange = (key: string, value: string) => {
        this.inputValues[key] = value;
    }

    @action
    handleConfirm = () => {
        traceLog('DialogStore.handleConfirm');
        if (this.type === 'input') {
            this.pendingResult = { ...this.inputValues };
        } else {
            this.pendingResult = true;
        }
        this.close();
    }

    @action
    handleNo = () => {
        if (this.type === 'confirm') {
            this.pendingResult = false;
        } else {
            this.pendingResult = undefined;
        }
        this.close();
    }

    @action
    handleCancel = () => {
        if (this.type === 'confirm' || this.type === 'input') {
            this.pendingResult = null;
        } else {
            this.pendingResult = undefined;
        }
        this.close();
    }

    // Handles native cancel (Escape key)
    onCancelled = (_e: React.SyntheticEvent<HTMLDialogElement, Event>) => {
        // It's important to prevent default if we want to control the close process? 
        // Or just let it close and set result.
        // Dialog 'close' event fires after this.
        if (this.type === 'confirm' || this.type === 'input') {
            this.pendingResult = null; // Map Escape to null (Cancel)
        } else {
            this.pendingResult = undefined;
        }
    }

    onClosed = () => {
        traceLog('DialogStore.onClosed', { pendingResult: this.pendingResult });
        if (this.resolvePromise) {
            this.resolvePromise(this.pendingResult);
            this.resolvePromise = null;
        }
        this.pendingResult = undefined;
    }

    // Handler for keyboard events within the dialog to support customized navigation if needed
    onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
        if (e.key === 'Escape') {
            // Native behavior handles this usually, but explicit handling ensures our state is correct
            e.stopPropagation();
            // Let native dialog handle closing via Escal
        }
    }
}

const dialogStore = new DialogStore();


export const NativeDialog: React.FC = observer(() => {
    const { type, message, title, alertIcon, okText, yesText, noText, showCancel, cancelText, fieldDefs, inputValues } = dialogStore;

    const defaultTitle = type === 'alert' ? 'Notification' : (type === 'input' ? 'Input' : 'Confirm');
    const displayTitle = title || defaultTitle;

    let iconClass = '';
    if (type === 'alert' && alertIcon) {
        switch (alertIcon) {
            case 'error': iconClass = 'fa-solid fa-circle-exclamation'; break;
            case 'warning': iconClass = 'fa-solid fa-triangle-exclamation'; break;
            case 'info': iconClass = 'fa-solid fa-circle-info'; break;
        }
    } else if (type === 'confirm') {
        iconClass = 'fa-solid fa-circle-question';
    }

    const iconColorMap: Record<string, string> = {
        error: styles.errorIcon,
        warning: styles.warningIcon,
        info: styles.infoIcon
    };

    const iconColorClass = type === 'alert' && alertIcon ? iconColorMap[alertIcon] : styles.confirmIcon;

    const btnsContainer = useRef<HTMLDivElement>(null);
    useLeftRightFocusNavigation(btnsContainer);

    return (
        <dialog
            ref={dialogStore.dialogRef}
            className={styles.root}
            onCancel={dialogStore.onCancelled}
            onClose={dialogStore.onClosed}
            onKeyDown={dialogStore.onKeyDown}
            data-testid="dialog-overlay"
        >
            <div className={styles.content}>
                <div className={styles.header} id="dialog-title" data-testid="dialog-title">{displayTitle}</div>
                <div className={styles.body}>
                    {iconClass && (
                        <i
                            className={`${iconClass} ${styles.icon} ${iconColorClass}`}
                            aria-hidden="true"
                            data-testid="dialog-icon"
                        />
                    )}
                    {type !== 'input' && <span className={styles.messageText} data-testid="dialog-message">{message}</span>}
                </div>
                {type === 'input' && (
                    <div className={styles.inputContainer}>
                        {Object.entries(fieldDefs).map(([key, def]) => (
                            <div key={key} className={styles.inputRow}>
                                <label className={styles.inputLabel} htmlFor={`dialog-input-${key}`}>{def.displayName}</label>
                                <input
                                    id={`dialog-input-${key}`}
                                    type="text"
                                    className={styles.inputField}
                                    value={inputValues[key] || ''}
                                    onChange={(e) => dialogStore.handleInputChange(key, e.target.value)}
                                    data-testid={`dialog-input-${key}`}
                                />
                            </div>
                        ))}
                    </div>
                )}
                <div className={styles.footer} ref={btnsContainer}>
                    <button key="true"
                        className={styles.primaryButton}
                        onClick={dialogStore.handleConfirm}
                        ref={dialogStore.confirmButtonRef}
                        data-testid="dialog-result-true"
                    >
                        {type === 'alert' || type === 'input' ? okText : yesText}
                    </button>
                    {type === 'confirm' && (
                        <button key="false"
                            className={styles.button}
                            onClick={dialogStore.handleNo}
                            data-testid="dialog-result-false"
                        >
                            {noText}
                        </button>
                    )}
                    {((type === 'confirm' && showCancel) || type === 'input') && (
                        <button key="null"
                            className={styles.button}
                            onClick={dialogStore.handleCancel}
                            data-testid="dialog-result-null"
                        >
                            {cancelText}
                        </button>
                    )}
                </div>
            </div>
        </dialog>
    );
});

export const dialog: Dialog = dialogStore;

// Expose for testing/debugging
if (typeof window !== 'undefined' && window.__TEST_ENABLE_GLOBALS) {
    window.__TEST_dialog = dialog;
}
