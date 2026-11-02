"use strict";

const path = require("path");
const { Worker } = require("worker_threads");

const run_in_worker = function(code) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(code, { eval: true });
        worker.once("message", (message) => {
            resolve(message);
            worker.terminate();
        });
        worker.once("error", reject);
    });
};

test("the memory backend works in a worker without process", async () => {
    const entry = path.join(__dirname, "..", "src", "fengari.js");
    const message = await run_in_worker(`
        const { parentPort } = require("worker_threads");
        /* simulate a worker-like global without Node's process */
        Object.defineProperty(globalThis, "process", { value: undefined, configurable: true });
        try {
            const { lauxlib, lualib, to_luastring, vfs } = require(${JSON.stringify(entry)});
            vfs.mount("/worker.txt", "worker data");
            const L = lauxlib.luaL_newstate();
            if (!L) throw new Error("no state");
            lualib.luaL_openlibs(L);
            const code = 'local f=assert(io.open("/worker.txt","r"))'
                + ' local s=f:read("a") f:close()'
                + ' assert(s=="worker data")'
                + ' assert(os.remove("/worker.txt"))'
                + ' return s';
            if (lauxlib.luaL_dostring(L, to_luastring(code)) !== 0)
                throw new Error("lua failed");
            parentPort.postMessage("worker ok");
        } catch (e) {
            parentPort.postMessage("worker error: " + e.message);
        }
    `);
    expect(message).toBe("worker ok");
});
