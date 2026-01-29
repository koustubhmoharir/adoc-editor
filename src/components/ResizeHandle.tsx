import React from 'react';
import * as styles from './ResizeHandle.css';

interface ResizeHandleProps {
    direction: 'horizontal' | 'vertical';
    onResize: (delta: number) => void;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({ direction, onResize }) => {
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const startPos = direction === 'horizontal' ? e.clientY : e.clientX;

        const handleMouseMove = (mmE: MouseEvent) => {
            const currentPos = direction === 'horizontal' ? mmE.clientY : mmE.clientX;
            const delta = currentPos - startPos;
            onResize(delta);
        };

        const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <div
            className={direction === 'horizontal' ? styles.horizontalHandle : styles.verticalHandle}
            onMouseDown={handleMouseDown}
            data-testid={`resize-handle-${direction}`}
        />
    );
};
