import { RefObject, useEffect, useRef } from "react";

const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
function handleVerticalKeyDown(e: KeyboardEvent) {
    const container = e.currentTarget as HTMLElement;
    const focusableElements = Array.from(container.querySelectorAll(focusableSelectors)) as HTMLElement[];

    if (focusableElements.length === 0) return;

    const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % focusableElements.length;
        focusableElements[nextIndex].focus();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = (currentIndex - 1 + focusableElements.length) % focusableElements.length;
        focusableElements[prevIndex].focus();
    } else if (e.key === 'Home') {
        e.preventDefault();
        focusableElements[0].focus();
    } else if (e.key === 'End') {
        e.preventDefault();
        focusableElements[focusableElements.length - 1].focus();
    }
}
function handleHorizontalKeyDown(e: KeyboardEvent) {
    const container = e.currentTarget as HTMLElement;
    const focusableElements = Array.from(container.querySelectorAll(focusableSelectors)) as HTMLElement[];

    if (focusableElements.length === 0) return;

    const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);

    if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % focusableElements.length;
        focusableElements[nextIndex].focus();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevIndex = (currentIndex - 1 + focusableElements.length) % focusableElements.length;
        focusableElements[prevIndex].focus();
    } else if (e.key === 'Home') {
        e.preventDefault();
        focusableElements[0].focus();
    } else if (e.key === 'End') {
        e.preventDefault();
        focusableElements[focusableElements.length - 1].focus();
    }
}

export function useUpDownFocusNavigationInPopover(popoverRef: RefObject<HTMLElement | null>, onClosed: () => void) {
    const closedRef = useRef<() => void>(null);
    closedRef.current = onClosed;
    useEffect(() => {
        const container = popoverRef.current;
        if (!container) return;
        container.addEventListener('keydown', handleVerticalKeyDown);

        const handleToggle = (e: any) => {
            switch (e.newState) {
                case "open":
                    e.currentTarget.focus({ preventScroll: true });
                    break;
                case "closed":
                    closedRef.current?.();
                    break;
            }
        }
        container.addEventListener('toggle', handleToggle);

        return () => {
            container.removeEventListener('keydown', handleVerticalKeyDown);
            container.removeEventListener('toggle', handleToggle);
        };
    }, [popoverRef]);
};

export function closeOnClick(e: React.MouseEvent) {
    const clickedElement = e.target as HTMLElement;
    const popover = e.currentTarget as HTMLElement;
    if (!clickedElement || !popover) return;
    if (!e.defaultPrevented && clickedElement.matches?.(focusableSelectors) && !clickedElement.getAttribute('data-keep-open')) {
        popover.hidePopover();
    }
}

export function useLeftRightFocusNavigation(containerRef: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        container.addEventListener('keydown', handleHorizontalKeyDown);

        return () => {
            container.removeEventListener('keydown', handleHorizontalKeyDown);
        };
    }, [containerRef]);
}