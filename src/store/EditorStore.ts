import { observable, action } from "mobx";

class EditorStore {
    @observable accessor content: string = "= Hello AsciiDoc\n\n* List item 1\n* List item 2\n\n[source,javascript]\n----\nconsole.log('Hello');\n----";

    @action
    setContent(newContent: string) {
        this.content = newContent;
    }
}

export const editorStore = new EditorStore();
