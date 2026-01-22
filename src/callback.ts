import { UserManager } from "oidc-client-ts";

// The popup callback doesn't need full config if it's just passing the code back.
// @ts-ignore
const mgr = new UserManager({});

mgr.signinPopupCallback().then(() => {
    window.close();
}).catch(err => {
    console.error(err);
    document.body.innerText = "Authentication failed: " + err.message;
});
