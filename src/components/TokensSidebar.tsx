import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import * as styles from './TokensSidebar.css';
import { tokensStore } from '../store/TokensStore';

export const TokensSidebar: React.FC = observer(() => {
    // Check if feature is enabled
    if (!window.__SHOW_TOKENS__) {
        return null;
    }

    useEffect(() => {
        tokensStore.initialize();
        return () => {
            tokensStore.dispose();
        };
    }, []);

    const { tokens, activeTokenIndex, checkedTokenIndices } = tokensStore;

    return (
        <div className={styles.sidebar}>
            <div className={styles.header}>
                <span>Token Visualization</span>
                <span>{tokens.length}</span>
            </div>
            <div className={styles.tokenList} ref={tokensStore.listRef}>
                {tokens.map((token, index) => (
                    <div
                        key={`${token.line}-${token.startColumn}`}
                        className={`${styles.tokenItem} ${index === activeTokenIndex ? styles.activeToken : ''}`}
                        onClick={() => tokensStore.handleTokenClick(token)}
                    >
                        <span className={styles.tokenLine}>{token.line}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                            <span className={styles.tokenType} title={token.type}>{token.type}</span>
                            <span className={styles.tokenText} title={token.text}>{token.text}</span>
                        </div>
                        {checkedTokenIndices.has(index) && (
                            <span className={styles.checkIcon} title="Valid test case">✓</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
});
