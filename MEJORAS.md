# Mejoras propuestas para Fengari

Catálogo de trabajo sobre `fengari` **v0.1.5** (commit `ac8c387`, semántica Lua 5.3).
Estado de partida: 40 suites de Jest, 589 tests que pasan y 21 skips, lint OK, sin build ni typecheck.

**Prioridad:** P0 desbloquea uso real · P1 calidad/rendimiento · P2 deseable · P3 largo plazo.
**Esfuerzo:** S < 1 día · M 1–5 días · L > 1 semana.
Las rutas son el punto de entrada sugerido, no una lista exhaustiva.

---

## Quick wins (P0, esfuerzo S)

- [x] **`collectgarbage`/`lua_gc`**: dejar de lanzar `"lua_gc not implemented"`; aceptar `collect`, `stop`, `restart`, `count`, `step`, `setpause`, `setstepmul`, `isrunning` y devolver valores coherentes con el GC de JS (`src/lbaselib.js`, exportar `lua_gc` en `src/lapi.js`).
- [x] **`string.format("%a"/"%A")`**: implementar los modificadores de precisión que hoy se rechazan (`src/lstrlib.js`, `str_format`).
- [x] **Metadatos de paquete**: añadir `exports`, `files`, `engines` y `type` a `package.json`; publicar solo `src/` y documentación. (`repository.directory` no aplica: es la raíz del repo).
- [ ] **Cobertura**: script `test:coverage` con `jest --coverage` y umbral mínimo; subir el informe en CI.
- [ ] **CI**: añadir Node 26, cachear dependencias, ejecutar `npm pack` como smoke test y validar que el tarball contiene lo esperado.
- [ ] **`debug.debug()`**: sustituir la dependencia obligatoria de `readline-sync` por un lector inyectable (Node TTY, `prompt()` del navegador o callback en workers) (`src/ldblib.js`).
- [x] **`math.random`**: corregida la aritmética del LCG con `Math.imul`; la secuencia es sembrable, determinista y reproducible (`src/lmathlib.js`).
- [ ] **Scripts**: `test:watch` y `lint:fix` en `package.json`.
- [x] **`globals`**: declarado como devDependency; `eslint.config.mjs` lo importa y faltaba en el manifiesto original.

---

## 1. Núcleo del lenguaje y semántica Lua 5.3

- **Tablas débiles (`__mode`)** — P1, L. Implementar `"k"`, `"v"` y `"kv"` con `WeakMap`/`WeakRef`, incluyendo ephemerons; al limpiar una entrada debe desaparecer de `next`/`pairs`. Punto de partida: `src/ltable.js`, `src/ltm.js`. Hoy el README las declara ausentes y la suite oficial las salta.
- **`__gc` y finalización** — P1, L. Usar `FinalizationRegistry` para llamar `__gc` de forma best-effort; documentar que no es determinista y que no resucita valores. Requiere no retener el objeto en el registro.
- **Trazas de error (`luaL_traceback`, `debug.traceback`)** — P1, M. Paridad con PUC: niveles, tail calls, funciones C/JS, `error(msg, level)` y `__tostring` del objeto de error. Adjuntar la traza como `cause` cuando un error Lua cruza a JS (`src/lauxlib.js`, `src/ldblib.js`).
- **Corrutinas** — P1, M. Cubrir yield a través de `pcall`/`xpcall` y metamétodos, propagación de errores, `resume` sobre hilo muerto e `isyieldable`; añadir `coroutine.close` (5.4) si se adopta esa versión (`src/lcorolib.js`, `src/ldo.js`).
- **Desbordamiento de pila** — P1, S. Traducir `RangeError: Maximum call stack size exceeded` a `"stack overflow"` de Lua, respetar `LUAI_MAXCCALLS`/`LUAI_MAXSTACK` y probar recursión profunda (hay tests oficiales saltados por esto).
- **Formato y parseo de números** — P2, M. Locale (coma decimal), floats hexadecimales, `inf`/`nan`, `tonumber` con base, distinción entero/float y `%g`/`%q` (`src/lobject.js`, `src/lstrlib.js`).
- **Bordes de enteros de 32 bits** — P2, S. `MININT // -1`, `MININT % -1`, desplazamientos, `math.tointeger`, conversiones string→int y saturación (`src/lvm.js`, `src/lmathlib.js`).
- **`table.sort`** — P3, S. Detectar comparadores inválidos y lanzar `"invalid order function for sorting"` como PUC; documentar que no es estable.
- **`next`/`pairs` con mutaciones** — P3, M. Definir y probar el comportamiento al insertar/borrar durante el recorrido; preservar el orden de iteración actual.
- **`os.date`/`os.time`** — P2, S. Formato `!` (UTC), tabla `*t`, zonas horarias, años > 2038 y `os.difftime` (`src/loslib.js`).
- **`os.execute`/`os.exit`** — P2, S. Devolver el triplete de Lua, no bloquear el hilo principal y dar errores claros en navegador/sandbox (`src/loslib.js`).
- **`load`/`loadfile`/`dofile`** — P2, S. Modos `"b"`/`"t"`, `env`, lectores por función, validación de chunks binarios y errores con nombre de archivo (`src/lbaselib.js`, `src/lundump.js`).
- **`string.pack`/`unpack`** — P2, M. Endianness, alineación, tamaños variables, strings con longitud y mensajes de error; ampliar tests de `test/test-suite/strings.test.js`.
- **`utf8`** — P3, S. Casos límite de secuencias inválidas, `utf8.offset` y `utf8.codepoint` (`src/lutf8lib.js`).
- **Librería `debug`** — P2, M. Hooks `call`/`return`/`line`/`count`, `getinfo` completo (qué, fuente, líneas, upvalues), `upvalueid`/`upvaluejoin` (`src/ldblib.js`, `src/ldebug.js`).
- **Cobertura de metamétodos** — P2, S. Verificar `__eq`, `__lt`, `__le`, `__concat`, `__len`, `__call`, `__index`/`__newindex` encadenados y errores cuando el metamétodo no es función.
- **Escapes y literales** — P3, S. `\u{}`, `\z`, corchetes largos, escapes decimales/hexadecimales y mensajes de error del lexer (`src/llex.js`).
- **Conversión de strings** — P3, S. Revisar `luaO_tostring`, strings largos vs cortos, interning y comparación por bytes.

---

## 2. Librería `io` y sistema de archivos

- **`io.read`** — P0, M. Formatos `"*n"`, `"*a"`, `"*l"`, `"*L"` y lectura de N bytes; stdin y archivos (`src/liolib.js`).
- **`io.lines` / `file:lines`** — P0, S/M. Formatos, cierre al llegar a EOF, iteradores reutilizables y errores de archivo cerrado.
- **`io.open` y `file:read/seek/setvbuf`** — P0, M/L. Modos `r/w/a/+`, binario, `errno` correcto, `io.type` y cierre determinista; backend Node con `fs` (`src/liolib.js`, `src/lauxlib.js`).
- **`io.input`/`io.output`** — P1, S. Cambiar el archivo por defecto, cerrar el anterior si corresponde y aceptar nombres o handles.
- **`io.tmpfile`/`os.tmpname`** — P1, S. Usar `tmp` en Node, limpiar al cerrar y dar un error explícito en navegador (`src/liolib.js`, `src/loslib.js`).
- **`io.popen`** — P2, M. `child_process` en Node; prohibido o simulado en navegador; devolver handle con `close` y código de salida.
- **Sistema de archivos virtual para navegador** — P2, L. OPFS/IndexedDB/MEMFS detrás de una fachada síncrona; documentar que OPFS síncrono solo existe en workers. Habilitaría `io` y `os.remove/rename` en el navegador.
- **`require` y `package.loadlib` en navegador** — P1, M. Eliminar el XHR síncrono: registro de módulos precargados, `require` asíncrono basado en corrutinas, soporte de ES modules e import maps; mantener `package.jspath` (`src/loadlib.js`).
- **`os.remove`/`os.rename` en navegador** — P2, S. Implementar sobre el VFS o fallar con un mensaje claro en vez de un error genérico.
- **`io` en navegador** — P2, L. Solo tiene sentido con el VFS; si no, documentar que la librería no se registra (`src/linit.js`).

---

## 3. Rendimiento

- **Suite de benchmarks** — P0, M. `bench/` con `fib`, `mandelbrot`, `nbody`, `spectral-norm`, `binary-trees`, estrés de strings/tablas; comparar contra PUC Lua 5.3 y contra el commit anterior.
- **Dispatch de la VM** — P1, L. Perfilar `luaV_execute` (`src/lvm.js`): orden del `switch`, evitar `new TValue` en bucles, reutilizar registros y reducir comprobaciones repetidas.
- **Representación de valores y pila** — P1, L. Evaluar pooling de `TValue`, arrays paralelos o tagged unions; eliminar `slice`/spread en rutas calientes y definir una política de crecimiento de `L.stack`.
- **Tablas** — P1, L. Parte densa para claves enteras, fast path sin `Map` para tablas pequeñas, rehash predecible, menos objetos auxiliares y orden de iteración estable (`src/ltable.js`).
- **Strings** — P1, M. `TextEncoder`/`TextDecoder` singleton, caché de conversiones UTF-8↔UTF-16, política de interning para strings largos y `Buffer` en Node (`src/defs.js`, `src/lstring.js`).
- **Compilador** — P2, M. Constant folding, peephole de `MOVE`/saltos, eliminación de código muerto y revisión del `FIXME` de `lcode.js:991`.
- **Presión de GC** — P1, M. Medir con `node --expose-gc`; reducir objetos temporales en API/VM y evitar retener slots muertos en la pila.
- **Arranque y tamaño** — P2, S. Carga perezosa de librerías, no requerir `io`/`os` en navegador y medir el tamaño del bundle (`src/linit.js`, `src/lualib.js`).
- **Backend WASM** — P3, L. Compilar PUC Lua a WebAssembly y mantener la misma fachada JS; comparar rendimiento y tamaño. Es la apuesta grande si el objetivo es velocidad cercana a nativa.
- **Caché de bytecode** — P3, M. Persistir `lua_dump` y cargar chunks precompilados para arranques repetidos.

---

## 4. Empaquetado, API y ecosistema JS

- **`exports`/`files`/`engines`** — P0, S. Sin esto, los bundlers no pueden resolver subrutas ni tree-shakear; `main` apunta a `src/fengari.js` y no hay mapa de exports (`package.json`).
- **Dual ESM/CJS** — P1, M. Los fuentes son CommonJS; añadir una capa ESM o migrar internamente y publicar ambos formatos. Mantener `require()` compatible.
- **Bundle de navegador** — P1, M. `dist/fengari.min.js` con esbuild/rollup, source maps y un test que lo cargue en un navegador real. Hoy los usuarios dependen de `fengari-web`.
- **Tipos TypeScript** — P1, L. Publicar `.d.ts` para `lua`, `lauxlib` y `lualib`, o habilitar `tsc --checkJs` con JSDoc incremental. La API C es enorme; priorizar los símbolos usados por `fengari-web`.
- **API de alto nivel** — P1, M. `run()`, `dostring()`, `call()`, registro de funciones JS, conversión de tablas/arrays y manejo de errores, para no obligar a usar la API C.
- **API asíncrona** — P1, M. Promesas para cargar módulos y para funciones JS que devuelven `Promise`, resolviendo con corrutinas para no romper la semántica síncrona de Lua.
- **Ciclo de vida de proxies** — P2, S. Revisar fugas de `lua_toproxy`, `lua_isproxy` entre estados y referencias que impiden el GC (`src/lapi.js`).
- **`fengari-interop`** — P2, M. Tests de integración con objetos, arrays, funciones, promesas e iteradores JS; documentar límites y conversiones.
- **Web Workers** — P2, M. `debug.debug` sin `readline-sync`, puente de mensajes y soporte opcional de `SharedArrayBuffer`.
- **Detección de entorno** — P2, S. Evitar falsos positivos de `typeof process` cuando un bundler inyecta un shim; centralizar la detección en un módulo.
- **Sandbox** — P1, M. Límites de instrucciones/tiempo con hooks, tope de memoria y librerías restringidas; exponer una API clara para ejecutar código no confiable.
- **FFI WebAssembly** — P3, L. Llamar funciones WASM desde Lua y viceversa, con manejo de memoria y tipos.

---

## 5. Calidad, tests y tooling

- **Cobertura con umbral** — P0, S. `jest --coverage`, reporte en CI y no bajar el porcentaje en cada PR.
- **Activar tests saltados** — P1, M. GC, `io.read`, pila profunda y límites de memoria (`test/test-suite/api.test.js` y otros). Cada feature nueva debería eliminar sus `test.skip`.
- **Tests de navegador** — P1, M. Playwright contra el bundle: XHR/`require`, workers, `debug.debug` y APIs ausentes en Node.
- **Tests diferenciales contra PUC Lua 5.3** — P1, M. Ejecutar el mismo corpus y comparar stdout, errores y códigos de salida; detectar divergencias de semántica.
- **Fuzzing del parser y `lundump`** — P1, M. Bytes aleatorios y chunks malformados no deben tumbar el proceso; usar un corpus semilla y límites de tiempo.
- **CI más completa** — P1, S. Node 26, caché, `npm pack`, matriz de gestores (yarn/pnpm) y workflow de publicación.
- **Scripts de desarrollo** — P0, S. `test:watch`, `test:coverage`, `lint:fix` y un `check` que encadene lint + tests.
- **Typecheck** — P2, M. `tsc --checkJs` sobre `src/` con `// @ts-check` gradual; los errores encontrados suelen revelar bugs reales.
- **Documentación** — P1, M. Referencia de API generada desde JSDoc, guía de inicio en navegador, ejemplos (REPL, host de plugins, bucle de juego) y guía de migración desde Lua C.
- **Contribución** — P2, S. `CONTRIBUTING.md`, plantillas de issue/PR, `SECURITY.md` y código de conducta.
- **Changelog** — P2, S. Automatizar `NEWS` desde commits etiquetados y documentar el proceso de release.
- **Higiene de dependencias** — P2, S. Hacer `readline-sync` opcional/lazy, revisar `tmp` y `sprintf-js`, y añadir auditoría periódica.
- **Política de lockfiles** — P1, S. CI usa `yarn.lock`; hoy conviven con `pnpm-lock.yaml`. Elegir uno, documentarlo y evitar que se desincronicen.
- **Tamaño del paquete** — P2, M. Medir `npm pack`, cargar librerías bajo demanda y eliminar código Node del bundle de navegador.

---

## 6. Lua 5.4 y futuro

- **`<const>` y `<close>`** — P2, L. Variables de solo lectura y to-be-closed, con `__close`; requiere cambios en parser, compilador y VM.
- **Enteros de 64 bits con `BigInt`** — P2, L. Opt-in vía `FENGARICONF` para no romper la semántica actual de 32 bits; afecta aritmética, formato, `string.pack` y bytecode.
- **`coroutine.close`, `warn`, `math.random` nuevo** — P2, M. Completar la superficie de 5.4 una vez decidida la versión objetivo.
- **Paridad de `utf8` y `string`** — P3, S. Revisar diferencias 5.3→5.4 y casos límite.
- **`debug`/`os` de 5.4** — P3, S. Nuevas funciones y cambios de comportamiento.
- **Extensiones tipo LuaJIT** — P3, L. Solo si hay un caso de uso claro (FFI, `bit`, `jit.*`); no forman parte de Lua estándar.

---

## Roadmap sugerido

1. **Fase 1 — Quick wins (1–2 semanas).** `lua_gc`, `%a`, `exports`/`files`/`engines`, cobertura, CI, scripts, benchmarks y `math.random`.
2. **Fase 2 — Navegador usable (2–4 semanas).** `io.read/open/lines`, `require` sin XHR, bundle + source maps, tipos TS y API de alto nivel.
3. **Fase 3 — Fidelidad (3–6 semanas).** Tablas débiles, `__gc`, tracebacks, corrutinas, tests diferenciales, fuzzing y tests de navegador.
4. **Fase 4 — Rendimiento y 5.4 (continuo).** Optimizar VM/tablas/strings, evaluar WASM y decidir si se adopta 5.4 con enteros de 64 bits.

## Cómo medir el éxito

- Porcentaje de la suite oficial de Lua que pasa sin `skip`.
- Diferencial contra PUC Lua 5.3: cero divergencias en el corpus.
- Benchmarks estables (mismo hardware, varias ejecuciones) y sin regresiones.
- Tamaño del bundle de navegador y tiempo de arranque.
- Cobertura de líneas/ramas y número de bugs de semántica abiertos.
