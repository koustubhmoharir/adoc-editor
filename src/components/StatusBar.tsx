
import { observer } from 'mobx-react-lite';
import { editorStore } from '../store/EditorStore';
import * as styles from './StatusBar.css';
import { ButtonMenu } from './Popovers';

export const StatusBar = observer(() => {
    return (
        <div className={styles.container} data-testid="status-bar">
            <button className={styles.languageButton} data-testid="status-bar-language-button">
                <span data-testid="status-bar-language">{editorStore.currentLanguage}</span>
                <ButtonMenu testid="status-bar-language-menu">
                    <div className={styles.languageList}>
                        {editorStore.availableLanguages.map((lang) => (
                            <button
                                key={lang.id}
                                onClick={() => editorStore.setLanguageId(lang.id)}
                                data-testid={`language-option-${lang.id}`}
                            >
                                {lang.aliases?.[0] || lang.id}
                            </button>
                        ))}
                    </div>
                </ButtonMenu>
            </button>
        </div>
    );
});
