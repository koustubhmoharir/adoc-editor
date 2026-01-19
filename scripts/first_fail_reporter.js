
import * as fs from 'fs';
import * as path from 'path';

class FirstFailReporter {
    constructor() {
        this.hasCapturedFailure = false;
        this.outputFile = path.join(process.cwd(), '.first_failure');
        //console.log('FirstFailReporter: Loaded. Output file:', this.outputFile);
    }

    onTestEnd(test, result) {
        if (this.hasCapturedFailure) {
            return;
        }

        if (result.status === 'failed' || result.status === 'timedOut') {
            this.hasCapturedFailure = true;
            const failureData = {
                file: test.location.file,
                title: test.title,
            };

            try {
                fs.writeFileSync(this.outputFile, JSON.stringify(failureData));
                //console.log('FirstFailReporter: Captured failure for', test.title);
            } catch (err) {
                console.error('FirstFailReporter: Failed to write failure file', err);
            }
        }
    }
}

export default FirstFailReporter;
