# Mejoras propuestas para Fengari

Catálogo de trabajo sobre `fengari` **v0.1.5** (commit `ac8c387`, semántica Lua 5.3).
Estado de partida: 40 suites de Jest, 589 tests que pasan y 21 skips, lint OK, sin build ni typecheck.
Estado actual tras resolver el P0: 40 suites, 597 tests que pasan y 21 skips, cobertura ~93% de líneas con umbral en CI.
Estado actual tras tablas débiles y `__gc`: 41 suites, 614 tests que pasan y 20 skips.
Estado actual tras GC automático/incremental y `count` real: 41 suites, 620 tests que pasan y 20 skips.
Estado actual tras marcado incremental y fidelidad de formato: 42 suites, 630 tests que pasan y 20 skips.
Estado actual tras versiones y locale: 43 suites, 640 tests que pasan y 20 skips.
Estado actual tras referencia de API y guía de migración: 44 suites, 644 tests que pasan y 20 skips.
Estado actual tras completar la librería `io`: 45 suites, 672 tests que pasan y 20 skips.
Estado actual tras el VFS de navegador: 47 suites, 692 tests que pasan y 20 skips.
Estado actual tras benchmarks, diferencial, fuzzing y API de alto nivel: 52 suites, 736 tests que pasan y 12 skips.
Estado actual tras rendimiento, fidelidad de `os.date`/`loadlib` y pulido: 56 suites, 761 tests que pasan, 10 skips y 93.1% de líneas / 85.2% de ramas.

**Prioridad:** P0 desbloquea uso real · P1 calidad/rendimiento · P2 deseable · P3 largo plazo.
**Esfuerzo:** S < 1 día · M 1–5 días · L > 1 semana.
Las rutas son el punto de entrada sugerido, no una lista exhaustiva.

---

## Quick wins (P0, esfuerzo S)

- [x] **`collectgarbage`/`lua_gc`**: dejar de lanzar `"lua_gc not implemented"`; aceptar `collect`, `stop`, `restart`, `count`, `step`, `setpause`, `setstepmul`, `isrunning` y devolver valores coherentes con el GC de JS (`src/lbaselib.js`, exportar `lua_gc` en `src/lapi.js`).
- [x] **`string.format("%a"/"%A")`**: implementar los modificadores de precisión que hoy se rechazan (`src/lstrlib.js`, `str_format`).
- [x] **Metadatos de paquete**: añadir `exports`, `files`, `engines` y `type` a `package.json`; publicar solo `src/` y documentación. (`repository.directory` no aplica: es la raíz del repo).
- [x] **Cobertura**: script `test:coverage` con `jest --coverage` y umbral mínimo; subir el informe en CI.
- [x] **CI**: añadir Node 26, cachear dependencias, ejecutar `npm pack` como smoke test y validar que el tarball contiene lo esperado.
- [x] **`debug.debug()`**: sustituir la dependencia obligatoria de `readline-sync` por un lector inyectable (Node TTY, `prompt()` del navegador o callback en workers) (`src/ldblib.js`).
- [x] **`math.random`**: corregida la aritmética del LCG con `Math.imul`; la secuencia es sembrable, determinista y reproducible (`src/lmathlib.js`).
- [x] **Scripts**: `test:watch`, `test:coverage`, `lint:fix` y `check` en `package.json`.
- [x] **`globals`**: declarado como devDependency; `eslint.config.mjs` lo importa y faltaba en el manifiesto original.

---

## 1. Núcleo del lenguaje y semántica Lua 5.3

- [x] **Tablas débiles (`__mode`)** — P1, L. Implementadas `"k"`, `"v"` y `"kv"` con un marcado/barrido propio sobre el grafo Lua, incluidos ephemerons; las entradas limpiadas desaparecen de `next`/`pairs`. La colección se dispara automáticamente tras un presupuesto de asignaciones y `step` limpia por lotes (`src/lgc.js`, `src/ltable.js`).
- [x] **`__gc` y finalización** — P1, L. Los objetos con `__gc` se registran al fijar el metatabla, se finalizan una sola vez durante `collectgarbage` (explícito o automático) y al cerrar el estado, y los errores se propagan como en PUC (`src/lgc.js`, `src/lapi.js`).
- [x] **Marcado incremental del GC** — P2, M. `step` reparte marcado, limpieza y finalización en lotes acotados. Las raíces, upvalues, hilos y userdata se re-escanean entre pasos y las escrituras en tablas/metatablas/uservalues usan barreras; solo el fixpoint de ephemerons queda atómico (`src/lgc.js`).
- [x] **Trazas de error (`luaL_traceback`, `debug.traceback`)** — P1, M. Paridad con PUC: niveles, tail calls, funciones C/JS, `error(msg, level)` y `__tostring` del objeto de error. Adjuntar la traza como `cause` cuando un error Lua cruza a JS (`src/lauxlib.js`, `src/ldblib.js`).
- [x] **Corrutinas** — P1, M. Cubrir yield a través de `pcall`/`xpcall` y metamétodos, propagación de errores, `resume` sobre hilo muerto e `isyieldable`; añadir `coroutine.close` (5.4) si se adopta esa versión (`src/lcorolib.js`, `src/ldo.js`).
- [x] **Desbordamiento de pila** — P1, S. Traducir `RangeError: Maximum call stack size exceeded` a `"stack overflow"` de Lua, respetar `LUAI_MAXCCALLS`/`LUAI_MAXSTACK` y probar recursión profunda (hay tests oficiales saltados por esto).
- [x] **Formato de floats (`%e`/`%f`/`%g`/`%G`)** — P2, M. Implementado con semántica de `printf` de C: exponencial, precisión por defecto, `-0`, `inf`/`nan`, flags (`+`, espacio, `#`, `0`, `-`) y ancho. Verificado contra `printf` en 238 casos (`src/lstrlib.js`).
- [x] **Locale (separador decimal)** — `os.setlocale` acepta locales de `Intl` para la categoría `numeric` (y `all`), y devuelve `nil` para `collate`/`ctype`/`monetary`/`time`, que no están implementadas. `string.format`/`%a` usan el separador decimal y `%q` mantiene el punto.
- [x] **Bordes de enteros de 32 bits** — P2, S. `MININT // -1`, `MININT % -1`, desplazamientos, `math.tointeger` y conversiones string→int cubiertos por tests (`test/fidelity.test.js`).
- [x] **`table.sort`** — P3, S. Detecta comparadores inválidos y lanza `"invalid order function for sorting"` como PUC; cubierto por tests.
- [x] **`next`/`pairs` con mutaciones** — P3, M. Cubierto por tests: limpiar y actualizar campos existentes durante el recorrido es seguro; preserva el orden de iteración actual.
- [x] **`os.date`/`os.time`** — P2, S. Formato `!` (UTC), tabla `*t`, zonas horarias, años > 2038 y `os.difftime` (`src/loslib.js`).
- [x] **`os.execute`/`os.exit`** — P2, S. Devuelven el triplete de Lua (`nil, "signal", <número>` si el proceso muere por señal), no bloquean más de lo necesario y dan errores claros en navegador/sandbox (`src/loslib.js`).
- [x] **`load`/`loadfile`/`dofile`** — P2, S. Modos `"b"`/`"t"`, `env`, lectores por función, validación de chunks binarios y errores con nombre de archivo (`src/lbaselib.js`, `src/lundump.js`).
- [x] **`string.pack`/`unpack`** — P2, M. Endianness, alineación, tamaños variables, strings con longitud y mensajes de error; ampliar tests de `test/test-suite/strings.test.js`.
- **`utf8`** — P3, S. Casos límite de secuencias inválidas, `utf8.offset` y `utf8.codepoint` (`src/lutf8lib.js`).
- [x] **Librería `debug`** — P2, M. Hooks `call`/`return`/`line`/`count`, `getinfo` completo (qué, fuente, líneas, upvalues), `upvalueid`/`upvaluejoin` (`src/ldblib.js`, `src/ldebug.js`).
- **Cobertura de metamétodos** — P2, S. Verificar `__eq`, `__lt`, `__le`, `__concat`, `__len`, `__call`, `__index`/`__newindex` encadenados y errores cuando el metamétodo no es función.
- **Escapes y literales** — P3, S. `\u{}`, `\z`, corchetes largos, escapes decimales/hexadecimales y mensajes de error del lexer (`src/llex.js`).
- **Conversión de strings** — P3, S. Revisar `luaO_tostring`, strings largos vs cortos, interning y comparación por bytes.

---

## 2. Librería `io` y sistema de archivos

- [x] **`io.read`** — P0, M. Formatos `"*n"`, `"*a"`, `"*l"`, `"*L"`, `"*0"` y lectura de N bytes; stdin y archivos (`src/liolib.js`).
- [x] **`io.lines` / `file:lines`** — P0, S/M. Formatos, cierre al llegar a EOF (solo cuando `io.lines` abrió el archivo), iteradores reutilizables y errores de archivo cerrado.
- [x] **`io.open` y `file:read/seek/setvbuf`** — P0, M/L. Modos `r/w/a/+` y `b`, `errno` correcto, `io.type` y cierre determinista; backend Node con `fs`. `seek` funciona en archivos regulares porque la posición se sigue en JS (Node no tiene `lseek`); `setvbuf` implementa un buffer de escritura `no`/`full`/`line` que se vuelca en `flush`, al llenarse, en un salto de línea, en `seek` y al cerrar.
- [x] **`io.input`/`io.output`** — P1, S. Cambian el archivo por defecto, aceptan nombres o handles y `io.close()` cierra la salida por defecto.
- [x] **`io.tmpfile`/`os.tmpname`** — P1, S. Archivo temporal en Node que se elimina al cerrar; `os.tmpname` ya existía.
- [x] **`io.popen`** — P2, M. `spawnSync` con shell: en modo lectura se ejecuta al abrir y se bufferiza stdout; en modo escritura los datos se acumulan y se envían al cerrar. `close` devuelve `"exit"`/`"signal"` con el código.
- [x] **Sistema de archivos virtual para navegador** — P2, L. `src/lfs.js` selecciona `fs` en Node y un FS en memoria cuando no hay `process`; `io` y `os.remove/rename/tmpname/getenv` funcionan sobre él. La API `fengari.vfs` permite montar/leer archivos, inyectar stdin/stdout/stderr, hacer `snapshot()`/`restore()` y persistir con `localStorage`, IndexedDB u OPFS (snapshots y, en workers, montaje directo con `mountOPFS`, rutas anidadas y archivos precreados).
- [x] **`os.remove`/`os.rename` en navegador** — P2, S. Implementados sobre el VFS con `errno` y mensajes claros.
- [x] **`io` en navegador** — P2, L. Registrada siempre en `luaL_openlibs`; `open/read/write/lines/seek/tmpfile` y `loadfile`/`dofile`/`require` consultan el VFS antes de caer al XHR síncrono. `popen`/`os.execute`/`os.exit` fallan con un error explícito.
- [x] **`require` y `package.loadlib` sin XHR en navegador** — P1, M. El VFS resuelve módulos Lua y JS montados (`.lua`/`.js`) sin red, además de `package.jspath` y `T.newuserdata`. El XHR síncrono queda solo como fallback para URLs no montadas (`vfs.allowNetwork(false)` lo desactiva). `vfs.loadFromURL` y `api.installAsyncModules` cargan módulos Lua, CommonJS y ES (con mapa de importación) de forma asíncrona bajo `runAsync`; falta `package.loadlib` asíncrono.

---

## 3. Rendimiento

- [x] **Suite de benchmarks** — P0, M. `bench/` con `fib`, `mandelbrot`, `nbody`, `spectral-norm`, `binary-trees`, estrés de strings/tablas; comparar contra PUC Lua 5.3 y contra el commit anterior.
- **Dispatch de la VM** — P1, L. Perfilar `luaV_execute` (`src/lvm.js`): orden del `switch`, evitar `new TValue` en bucles, reutilizar registros y reducir comprobaciones repetidas.
- **Representación de valores y pila** — P1, L. Evaluar pooling de `TValue`, arrays paralelos o tagged unions; eliminar `slice`/spread en rutas calientes y definir una política de crecimiento de `L.stack`. Hecho: los `CallInfo` se reutilizan y la pila ya no se vuelve “holey” al retornar (medido: −20.7% global, `fib` −70.7%; 10.2x frente a PUC Lua 5.4 en vez de 12.7x).
- **Tablas** — P1, L. Parte densa para claves enteras, fast path sin `Map` para tablas pequeñas, rehash predecible, menos objetos auxiliares y orden de iteración estable (`src/ltable.js`).
- **Strings** — P1, M. `TextEncoder`/`TextDecoder` singleton, caché de conversiones UTF-8↔UTF-16, política de interning para strings largos y `Buffer` en Node (`src/defs.js`, `src/lstring.js`).
- **Compilador** — P2, M. Constant folding, peephole de `MOVE`/saltos, eliminación de código muerto y revisión del `FIXME` de `lcode.js:991`.
- **Presión de GC** — P1, M. `collectgarbage("count")` ya mide objetos Lua vivos; usar esa métrica para reducir asignaciones temporales en API/VM y evitar retener slots muertos en la pila.
- **Arranque y tamaño** — P2, S. Carga perezosa de librerías, no requerir `io`/`os` en navegador y medir el tamaño del bundle (`src/linit.js`, `src/lualib.js`).
- **Backend WASM** — P3, L. Compilar PUC Lua a WebAssembly y mantener la misma fachada JS; comparar rendimiento y tamaño. Es la apuesta grande si el objetivo es velocidad cercana a nativa.
- **Caché de bytecode** — P3, M. Persistir `lua_dump` y cargar chunks precompilados para arranques repetidos.

---

## 4. Empaquetado, API y ecosistema JS

- [x] **`exports`/`files`/`engines`** — P0, S. Sin esto, los bundlers no pueden resolver subrutas ni tree-shakear; `main` apunta a `src/fengari.js` y no hay mapa de exports (`package.json`).
- [x] **Dual ESM/CJS** — P1, M. Los fuentes son CommonJS; añadir una capa ESM o migrar internamente y publicar ambos formatos. Mantener `require()` compatible.
- [x] **Bundle de navegador** — P1, M. `scripts/build-browser.js` genera `dist/fengari.js` (IIFE con `sprintf-js` y stubs de módulos Node) sin dependencias; se construye también en `pnpm pack` y se prueba en navegador real.
- [x] **Tipos TypeScript** — P1, L. Publicar `.d.ts` para `lua`, `lauxlib` y `lualib`, o habilitar `tsc --checkJs` con JSDoc incremental. La API C es enorme; priorizar los símbolos usados por `fengari-web`.
- [x] **API de alto nivel** — P1, M. `run()`, `dostring()`, `call()`, registro de funciones JS, conversión de tablas/arrays y manejo de errores, para no obligar a usar la API C.
- [x] **API asíncrona** — P1, M. `api.pushAsyncJS` + `runAsync`/`callAsync` ejecutan el chunk en una corrutina, esperan cada `Promise` y la reanudan; una promesa rechazada se convierte en error Lua. `installAsyncModules` carga Lua/CommonJS/ESM de forma asíncrona bajo `runAsync`.
- [x] **Ciclo de vida de proxies** — P2, S. Revisado: el registro es un `WeakMap` de proxy→estado y no retiene proxies; `lua_isproxy` distingue estados y hay test de ámbito y error entre estados (`src/lapi.js`, `test/lapi.test.js`).
- **`fengari-interop`** — P2, M. Tests de integración con objetos, arrays, funciones, promesas e iteradores JS; documentar límites y conversiones.
- [x] **Web Workers** — P2, M. El backend en memoria y la E/S funcionan sin `window`/`process`; la suite de Brave prueba un Web Worker real, RPC asíncrono y un puente bloqueante con `SharedArrayBuffer`/`Atomics`. `test/worker.test.js` cubre io/os en `worker_threads`.
- [x] **Detección de entorno** — P2, S. Evitar falsos positivos de `typeof process` cuando un bundler inyecta un shim; centralizar la detección en un módulo.
- [x] **Sandbox** — P1, M. `api.sandbox` oculta `io`/`os`/`package`/`debug`/`dofile`/`loadfile`/`require` y limita instrucciones, tiempo y memoria aproximada (`collectgarbage("count")`).
- **FFI WebAssembly** — P3, L. Llamar funciones WASM desde Lua y viceversa, con manejo de memoria y tipos.

---

## 5. Calidad, tests y tooling

- [x] **Cobertura con umbral** — `jest --coverage`, reporte en CI y umbral global (90% statements/funciones/líneas, 85% ramas).
- **Activar tests saltados** — P1, M. Quedan 10: 9 de API (límites de memoria/`T.totalmem`, colores del GC, `objsize` de memoria, C-stack) y 1 de internals de tabla. Activados los de `table`/`debug.setmetatable`, reutilización de referencias, cadena larga de userdata, finalización durante la colecta y locale. Cada skip restante está documentado con su motivo en `test/test-suite/SKIPS.md`.
- [x] **Tests de navegador** — P1, M. `scripts/browser-test.js` usa el Chrome DevTools Protocol contra Brave headless (fallback Chromium/Chrome), sin Playwright: 19 pruebas con VFS, `require`/`dofile` sin XHR, Lua/CJS/ESM asíncronos, localStorage, IndexedDB, OPFS (snapshots y directo anidado), SharedArrayBuffer, worker RPC (async y bloqueante), `debug.debug`, bundle minificado/source map, stdout y sandbox.
- [x] **Tests diferenciales contra PUC Lua** — P1, M. `scripts/diff-puc.js` ejecuta `test/differential/` bajo Fengari y PUC y compara stdout y éxito/fallo; el test de Jest se salta si no hay intérprete.
- [x] **Fuzzing del parser y `lundump`** — P1, M. `scripts/fuzz.js` con PRNG sembrado, bytes aleatorios, fuente aleatoria y bytecode mutado; `test/fuzz.test.js` ejecuta una tanda acotada.
- [x] **CI más completa** — Node 20–26, caché de yarn, `--frozen-lockfile`, cobertura, tarball, diferencial contra PUC, benchmarks y fuzzing. Queda un workflow de publicación.
- [x] **Scripts de desarrollo** — `test:watch`, `test:coverage`, `lint:fix` y `check`.
- **Typecheck** — P2, M. `tsc --checkJs` sobre `src/` con `// @ts-check` gradual; los errores encontrados suelen revelar bugs reales.
- [x] **Referencia de API generada y guía C→JS** — `scripts/generate-api-docs.js` genera `docs/api.md` desde las declaraciones y exports (con `docs:check` en CI), y `docs/migrating-from-c.md` cubre strings, enteros, pila, tablas, errores, userdata, registry, corrutinas, GC, versiones y diferencias con la API C.
- **Documentación de uso** — P1, M. Guía de inicio en navegador, ejemplos (REPL, host de plugins, bucle de juego) y una referencia con JSDoc enriquecido; el generador actual usa las declaraciones y comentarios existentes.
- [x] **Contribución** — P2, S. `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, plantillas de issue/PR y enlaces desde el README.
- **Changelog** — P2, S. Automatizar `NEWS` desde commits etiquetados y documentar el proceso de release.
- **Higiene de dependencias** — P2, S. Revisar `tmp` y `sprintf-js` y añadir auditoría periódica (`readline-sync` ya es opcional en tiempo de ejecución).
- [x] **Política de lockfiles** — `yarn.lock` es la fuente de verdad, `pnpm-lock.yaml` está ignorado y CI instala con `--frozen-lockfile`.
- **Tamaño del paquete** — P2, M. Medir `npm pack`, cargar librerías bajo demanda y eliminar código Node del bundle de navegador.

---

## 6. Versiones de Lua

- [x] **Registro de implementaciones** — `versions.register/get/list/setDefault/features`, `luaL_newstate(version)` y `FENGARICONF.LUA_VERSION`; hooks `openlibs` y `loadbufferx` (`src/versions.js`). Perfiles incluidos: 5.1, 5.2, 5.3 y 5.4 (superficie de librerías).
- [x] **Perfiles 5.1 y 5.2 de superficie de librerías** — `bit32`, aliases y eliminación de APIs 5.3, `package.loaders`, `getfenv`, `math.*` compatibles (`src/versions/`, `src/lbitlib.js`).
- **Semántica completa 5.1/5.2** — P2, L. Los perfiles solo cubren librerías. Verificado: 5.1/5.2 siguen aceptando `//`, `&` y `<<`; 5.1 acepta `goto`; `tostring(1.0)` sigue dando `"1.0"`. Hecho: `getfenv`/`setfenv`, `module`, `package.seeall` y `loadstring` en 5.1 sobre el upvalue `_ENV` (las funciones que comparten `_ENV` comparten entorno). Falta lexer/parser y `undump` por versión, modelo numérico double para 5.1/5.2 y APIs menores (`newproxy`, `table.setn`, `os.exit` booleano, `load` con lector en 5.1).

## 7. Lua 5.4 y futuro

- [x] **`<const>` y `<close>`** — P2, L. Atributos `local x <const>`/`<close>` en el perfil 5.4: comprobación de asignación a const (incluidos upvalues), `OP_TBC`/lista de cierres por hilo y `__close(valor, err)` en salida de bloque, `break`, `goto`, `return`, tail call, errores, `coroutine.close` y el cuarto valor to-be-closed del generic-for (`OP_TFORPREP`). `__close` puede hacer yield en el cierre normal y la operación se reanuda (`luaV_finishOp` para `OP_CLOSE`/`OP_RETURN`/jump de cierre); durante el desenrollado de errores el cierre no es yieldable.
- **Enteros de 64 bits con `BigInt`** — P2, L. Implementado detrás de `FENGARICONF.LUA_INT64`: `TValue`/`lua_int` con canonicalización a `BigInt`, parser numérico, literales, `tonumber`/`tostring`, aritmética/comparaciones, `for` numérico, claves de tabla, `math.*` (incluido `random`/`randomseed` 5.4), `string.pack/unpack` con `i8`/`I8`, `string.format`, partes de `table`/`os` y dump/undump con formato 1. La interop 0/1 es controlada: se carga el otro formato y se rechazan constantes que no caben. El modo por defecto sigue siendo 32 bits. Pendiente: cubrir cualquier función de librería restante que asuma `Number`, y `__close` con yield.
- [x] **`coroutine.close`, `warn`, `math.random` nuevo** — P2, M. Perfil `5.4` con `coroutine.close` (suspended/dead/error; `__close` aún no existe), `warn` con `lua_setwarnf`/`lua_warning` y un `math.random`/`randomseed` 5.4 con xoshiro128**, semillas por estado y soporte de 0/1/2 argumentos. El parser/VM siguen siendo 5.3 y el entero es de 32 bits, así que no se replica la secuencia exacta de PUC.
- **Paridad de `utf8` y `string`** — P3, S. Revisar diferencias 5.3→5.4 y casos límite.
- **`debug`/`os` de 5.4** — P3, S. Nuevas funciones y cambios de comportamiento.
- **Extensiones tipo LuaJIT** — P3, L. Solo si hay un caso de uso claro (FFI, `bit`, `jit.*`); no forman parte de Lua estándar.

---

## Límites conocidos actuales

- **Versiones**: el parser/VM es 5.3; los perfiles 5.1/5.2/5.4 ajustan la superficie de librerías (5.4 añade `coroutine.close`, `warn`, `math.random` nuevo y `<const>`/`<close>`), no la sintaxis ni el modelo numérico. 5.4 no incluye enteros de 64 bits por defecto (modo opt-in aparte) y `__close` solo puede hacer yield al desenrollar normalmente, no al propagar un error; `setfenv`/`module` de 5.1 comparten el upvalue `_ENV` y no pueden cambiar funciones sin `_ENV`; 5.2 no expone esas funciones.
- **Enteros**: por defecto son de 32 bits. Con `FENGARICONF.LUA_INT64=true` pasan a `BigInt` de 64 bits con bytecode marcado (format 1) e interop controlada con format 0; están cubiertos núcleo, parser, aritmética/comparaciones, `for`, claves, `math.*`, `string.pack/unpack`, formato, `table`/`os` y dump/undump.
- **GC**: `count` usa tamaños estimados por tipo; `collect` es atómico y solo `step` es incremental. Los valores retenidos únicamente por JS no cuentan como raíces.
- **Fidelidad**: locale solo cubre el separador decimal (`ctype`/collation siguen en "C"); `%q` para `inf`/`nan` mantiene el estilo 5.3; los tracebacks no garantizan paridad exacta de marcos C/JS.
- **Navegador**: `require`/`package.loadlib` caen a XHR síncrono si el módulo no está montado y la red está permitida; `installAsyncModules` cubre Lua, CommonJS y ESM asíncronos (import maps), pero `package.loadlib` sigue siendo síncrono. El VFS es en memoria salvo `mountOPFS` en workers (rutas anidadas y archivos precreados); la persistencia usa `saveToStorage`/`saveToIndexedDB`/`saveToOPFS`. `vfs.allowNetwork(false)` elimina el XHR.
- **`io`**: `popen`, `os.execute` y `os.exit` necesitan una API de procesos; en el VFS fallan con un error claro. `popen` ejecuta el comando de forma síncrona y bufferiza (no hay streaming); `setvbuf` controla un buffer de escritura en JS; `seek` usa una posición en JS y falla con `ESPIPE` en pipes y terminales.

---

## Roadmap sugerido

1. **Fase 1 — Completada.** P0, tablas débiles/`__gc`, GC automático/incremental, `count` real, fidelidad de floats/locale/tracebacks, perfiles de versión y tooling.
2. **Fase 2 — Versiones reales (4–8 semanas).** Lexer/parser y modelo numérico por versión, entornos por función (`setfenv`/`module`), `undump` por versión y APIs menores de 5.1/5.2.
3. **Fase 3 — Navegador (completada).** VFS, persistencia (localStorage/IndexedDB/OPFS), bundle con source maps y minificado, carga asíncrona de Lua/CJS/ESM y RPC de workers (async y SAB) están hechos y probados con CDP; quedan `package.loadlib` asíncrono y cobertura Firefox/Safari.
4. **Fase 4 — Medición (en curso).** `bench/`, diferencial contra PUC y fuzzing completados; quedan la optimización de VM/tablas/strings y los tests de navegador.
5. **Fase 5 — Largo plazo.** Lua 5.4, enteros de 64 bits con `BigInt`, WASM/FFI.

## Cómo medir el éxito

- Porcentaje de la suite oficial de Lua que pasa sin `skip`.
- Diferencial contra PUC Lua 5.3: cero divergencias en el corpus.
- Benchmarks estables (mismo hardware, varias ejecuciones) y sin regresiones.
- Tamaño del bundle de navegador y tiempo de arranque.
- Cobertura de líneas/ramas y número de bugs de semántica abiertos.
