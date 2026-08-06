# Tag "pagado" y total pendiente en servicios

Fecha: 2026-08-06

## Problema

En la pestaña Servicios, un servicio manual ya pagado se distingue de uno que falta pagar
por una palabra en la línea gris de abajo: `Efectivo · pagado`. Es el texto más chico de
la fila y compite con el nombre del medio de pago. De un vistazo, en el celular, no se ve
cuáles ya están saldados.

Y no hay ningún número que diga cuánta plata falta que salga. El total grande de arriba es
el gasto fijo del mes completo, que no responde esa pregunta: incluye los automáticos, que
no hay que hacer nada para pagarlos.

## Decisiones tomadas

- **El tag va solo en los manuales.** Los automáticos nacen `'pagado'` el día que se
  generan, no el día que se debitan: el 1 de agosto se crea el gasto de Netflix con fecha
  25/8 ya marcado pagado. Un tag ahí diría "pagado" tres semanas antes de que salga la
  plata. Los manuales sí tienen un estado real que seguir, porque alguien aprieta "Pagar".
- **El total pendiente no filtra por servicio.** Solo los manuales generan pendientes
  (`estadoInicial` hace nacer `'pagado'` a los automáticos), así que todo `mov` en estado
  `'pendiente'` ya es, por definición, un manual sin pagar. Cruzar contra la tabla
  `servicio` sería redundante y podría desincronizarse de lo que muestran las listas.
- **Suma todo lo pendiente, no solo el mes corriente.** Incluye los vencidos arrastrados de
  meses anteriores y los de servicios dados de baja. Es la plata que falta que salga de
  verdad. Los atrasados igual se siguen viendo aparte, con su tag rojo.
- **Se calcula al renderizar**, como todo lo demás en esta app. No hay contador guardado.
- **No se toca la base de datos ni el Worker.** Es todo `public/index.html`: la información
  ya viaja en `/api/state`.

## Comportamiento

### Tag "pagado"

En `filaMes()`, en la misma posición donde hoy aparece `<span class="tag venc">vencido</span>`:

```
Agua                [pagado]
Efectivo                        $12.300
```

Cuando el servicio está pagado, la línea gris deja de decir `· pagado` y muestra solo el
medio de pago. El tag comunica el estado; el sub, dónde salió la plata. Decir las dos cosas
sería repetirse en la fila más angosta de la app.

Los otros estados no cambian: `omitido` sigue con la fila al 50% y el texto "salteado este
mes", y el pendiente sigue mostrando la fecha de vencimiento y el botón "Pagar".

### Total pendiente

Debajo del total grande de gasto fijo, dentro de la misma tarjeta:

```
Gasto fijo mensual
┌─────────────────────────────────────┐
│           $267.000                  │
│ automáticos $141.300 · los pagás    │
│ vos $125.700                        │
│                                     │
│    Falta pagar  $113.400            │
└─────────────────────────────────────┘
```

Cálculo:

```js
const falta = movs.filter(m => m.estado === "pendiente")
                  .reduce((a, m) => a + m.monto, 0);
```

Ese filtro cubre exactamente lo que ya se ve más abajo en pantalla: los pendientes del mes
de servicios activos (que renderiza `filaMes`) más los de la lista `vencidos` (meses
anteriores o servicios dados de baja). No existen pendientes de meses futuros, porque
`generarDelMes()` solo genera el mes corriente.

**Si no falta pagar nada, la línea se oculta.** No muestra `$0`. Estar al día es el caso
normal a fin de mes y la pantalla vuelve a lo que era.

El rótulo "Falta pagar" en `--muted`, el monto en `--ink` y `mono`, separado del bloque de
arriba por un borde `--line`. Nada de `--danger`: los atrasados ya tienen su tag rojo, y
teñir el total de rojo haría sonar alarma el día 2 del mes, cuando todavía no venció nada.

## Fuera de alcance

- **Tag "pagado" en automáticos.** Requeriría una regla nueva (mostrarlo solo si ya pasó el
  día del débito) para no mentir. Si más adelante se quiere, esa es la forma.
- **Tocar el "Total a vencer" de la pestaña Mes.** Suma solo el mes corriente y responde
  otra pregunta: qué vence ahora. Los dos números pueden diferir legítimamente cuando hay
  atrasados, y está bien.

## Tests

No se agregan. Los dos cambios son render en `public/index.html`, que no tiene
infraestructura de test — igual que `impactos()`, bastante más delicada y que vive ahí sin
tests. Extraer un `filter`/`reduce` de una línea a `src/servicios.mjs` para cubrirlo lo
dejaría como el único pedazo de lógica de render testeado, sin ganar nada.

Verificación a mano, con estos casos:

1. Un manual pagado muestra el tag y **no** repite "pagado" en la línea gris.
2. Un manual pendiente no muestra tag y conserva el botón "Pagar".
3. Un manual omitido sigue al 50% y dice "salteado este mes".
4. "Falta pagar" coincide con la suma de las filas con botón "Pagar" que se ven en pantalla,
   incluidos los vencidos de arriba.
5. Con todo pagado, la línea desaparece.
6. Apretar "Pagar" en un servicio baja el total y le pone el tag, sin recargar la página.
