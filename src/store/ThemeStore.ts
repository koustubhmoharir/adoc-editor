import { observable, action } from "mobx";
import * as monaco from 'monaco-editor';

type Theme = 'light' | 'dark';

class ThemeStore {

    constructor() {
        const savedTheme = localStorage.getItem('app-theme') as Theme | null;
        if (savedTheme) {
            this.theme = savedTheme;
        }
    }

    @observable private accessor _theme: Theme = 'light';
    get theme() { return this._theme; }
    set theme(val: Theme) {
        this._theme = val;
        monaco.editor.setTheme(val === 'light' ? 'vs' : 'vs-dark');
    }

    get monacoTheme() { return this.theme; }

    @action.bound
    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('app-theme', this.theme);
    }
}

export const themeStore = new ThemeStore();

export const appName = 'ADoc Editor';