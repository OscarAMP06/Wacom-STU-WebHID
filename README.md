# Almacén D954 · Firma digital

Herramienta web del almacén de Transportación (Taller Automotriz Claro, centro D954) para firmar documentos con el pad **Wacom STU-540** y resolver el papeleo diario del almacén desde el navegador: conduces de SAP, despachos de EPP y uniformes, recepción de materiales y traslados desde Alameda.

**Abrir la herramienta:** https://oscaramp06.github.io/Wacom-STU-WebHID/

No hay que instalar programas ni drivers: el navegador se conecta al pad por USB (WebHID). Todo se procesa en la computadora; los documentos, el historial y los catálogos se guardan en las carpetas que elijas y en el navegador, no en un servidor.

## Módulos

| Pestaña | Para qué sirve |
|---|---|
| **Documento SAP** | Elige un PDF de SAP y fírmalo en el pad, o firma varios de la misma persona de una vez. |
| **Firmar PDF** | Abre cualquier conduce o factura escaneada (PDF, JPG o PNG), coloca y ajusta tu firma, o firma en el pad viendo el documento en su pantalla. |
| **Cargo Directo** | Toma la firma de quien recibe materiales de Cargo Directo y guarda solo la imagen de la firma para anexarla en Power Apps. |
| **Materiales Seguridad** | Despacho de EPP con conduce firmado, historial por empleado y panel de consumo. |
| **Uniformes** | Despacho de uniformes con conduce firmado, catálogo e inventario e historial de cada persona. |
| **Recepción** | Carga el conduce o la factura del suplidor y prepara el correo a Recepción Alameda para que den entrada en SAP. |
| **Traslado Alameda** | Con los export de SAP y el catálogo de capacidades, sugiere qué pedir a Alameda y genera el **FORM-PRO-1374-01** listo para el requerimiento. |
| **Firmados** | Consulta, copia el número de documento o abre cualquier PDF ya firmado. |

El botón **⚙** abre la configuración: carpetas de trabajo, color y grosor de la pluma, brillo y pantalla del pad, y catálogos.

## Requisitos

- **Google Chrome o Microsoft Edge** en Windows (WebHID y acceso a carpetas solo funcionan en navegadores basados en Chromium).
- **Pad Wacom STU-540** conectado por USB. Sin el pad se puede usar todo lo que no sea firmar en el pad.
- Internet la primera vez, para descargar las librerías (pdf.js, pdf-lib, SheetJS, JSZip y las fuentes). Después funciona sin conexión gracias a la caché (`sw.js`).

## Uso diario

1. Abre la herramienta y pulsa **Conectar** en el aviso del pad; Chrome pedirá elegir el dispositivo la primera vez.
2. En **⚙**, conecta las carpetas de trabajo (documentos de SAP, firmados, materiales, uniformes). El navegador recuerda el permiso.
3. Trabaja en la pestaña que necesites. Los PDF firmados se guardan en la carpeta conectada; si no hay carpeta, se descargan.

### Traslado semanal desde Alameda

1. Exporta de SAP el **movimiento de materiales** (con CMv, Cantidad y Fe.contab.), el **stock de D954** y el **stock de Alameda** (con Libre utiliz.).
2. Arrástralos a la pestaña **Traslado Alameda** junto con el **catálogo de capacidades** de SharePoint (CSV). La web reconoce cada archivo; el catálogo queda guardado para las próximas semanas.
3. Revisa el pedido sugerido (capacidad máxima − stock, sin pasar de lo que tiene Alameda), acepta los extras de alta rotación si hacen falta y pulsa **Descargar FORM-PRO-1374-01**.
4. **Exportar reposición** baja aparte lo que Alameda no puede completar.

## Archivos del repositorio

| Archivo | Qué es |
|---|---|
| `index.html` | La herramienta completa: interfaz, estilos y lógica en un solo archivo, sin compilación. |
| `wacomstu540.js` | Librería que habla con el pad por WebHID (conectar, pantalla, imágenes, datos de la pluma). |
| `sw.js` | Caché sin conexión: librerías de CDN desde caché; archivos propios primero desde la red para recibir siempre la última versión. |
| `demo-v2.html` | Redirige a `index.html` para que los enlaces viejos sigan funcionando. |

## Publicar cambios

GitHub Pages publica la rama `main` automáticamente. Cualquier cambio subido a `main` está en línea en uno o dos minutos; si el navegador muestra la versión anterior, recarga con **Ctrl+F5**.

Para probar localmente, sirve la carpeta con un servidor (WebHID y la caché necesitan `https` o `localhost`):

```
python -m http.server 8000
```

y abre http://localhost:8000.

## Créditos

La comunicación con el pad parte de la librería [Wacom-STU-WebHID](https://github.com/pabloko/Wacom-STU-WebHID) de Pablo García, publicada bajo licencia MIT (ver `LICENSE`).
