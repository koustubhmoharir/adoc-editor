import { UserManager } from "oidc-client-ts";

// The popup callback doesn't need full config if it's just passing the code back.
// We use a minimal UserManager instantiation.
// @ts-ignore
const mgr = new UserManager({});
//     {
//     authority: "https://placeholder", // Library might complain if missing, but value shouldn't matter for callback
//     client_id: "placeholder",
//     redirect_uri: window.location.origin + "/callback.html",
//     response_mode: "query"
// });

mgr.signinPopupCallback().then(() => {
    window.close();
}).catch(err => {
    console.error(err);
    document.body.innerText = "Authentication failed: " + err.message;
});
