/*
    WACOM STU-540 WebHID Driver
    ___________________________________________________
    Pablo García <pablomorpheo@gmail.com>
    https://github.com/pabloko/Wacom-STU-WebHID
*/
var wacomstu540 = function () {
    // Check if WebHID is supported
    if (navigator == null || navigator.hid == null) return null
    /**
     * Device configuration, information and capabilities
     */
    this.config = {
        chunkSize: 253,
        vid: 1386,
        pid: 168,
        imageFormat24BGR: 0x04,
        width: 800,
        height: 480,
        scaleFactor: 13.5,
        pressureFactor: 1023,
        refreshRate: 0,
        tabletWidth: 0,
        tabletHeight: 0,
        deviceName: null,
        firmware: null,
        eSerial: null,
        onPenDataCb: null,
        onHidChangeCb: null,
        onErrorCb: null,
        onImageProgressCb: null,
    }
    /**
     * Report ids (See SDK for more info and compatibility matrix, direction, etc...)
     */
    this.command = {
        penData: 0x01,
        information: 0x08,
        capability: 0x09,
        writingMode: 0x0E,
        eSerial: 0x0F,
        clearScreen: 0x20,
        inkMode: 0x21,
        writeImageStart: 0x25,
        writeImageData: 0x26,
        writeImageEnd: 0x27,
        writingArea: 0x2A,
        brightness: 0x2B,
        backgroundColor: 0x2E,
        penColorAndWidth: 0x2D,
        penDataTiming: 0x34,
    }
    // Store internal hidDevice 
    this.device = null
    // Store internal image chunks to resend without reprocess
    this.image = null
    // ---- Optimización (Oscar Amparo / v2) ----
    // Cola única de comandos: los reportes HID se envían SIEMPRE en orden y nunca
    // se mezclan dos imágenes ni un comando a mitad de una imagen.
    this._cola = Promise.resolve()
    this._imagenPendiente = null      // última imagen pedida mientras otra se transfería (solo cuenta la más reciente)
    this._transfiriendo = false
    this._promesaImagen = null
    this._ultimaImagen = null         // última imagen que el pad tiene en pantalla (para no reenviar la misma)
    this._pantallaSucia = true        // true si el lápiz dibujó tinta desde el último envío
    this.ultimaActividad = 0          // ms de la última comunicación exitosa con el pad
    this.ultimoError = null
    /**
     * Ejecuta fn en la cola (una operación a la vez, en orden de llegada)
     */
    this._ejecutar = function (fn, limiteMs) {
        // Cada operación tiene un tiempo máximo: si el pad se cuelga, la cola no queda bloqueada
        const limite = limiteMs || 5000
        const correr = function () {
            return new Promise(function (ok, mal) {
                const t = setTimeout(function () { mal(new Error('El pad no respondió a tiempo')) }, limite)
                Promise.resolve().then(fn).then(function (v) { clearTimeout(t); ok(v) }, function (e) { clearTimeout(t); mal(e) })
            })
        }
        const p = this._cola.then(correr, correr)
        this._cola = p.catch(function () { })
        return p
    }.bind(this)
    this._reportarError = function (e) {
        this.ultimoError = e
        if (this.config.onErrorCb) { try { this.config.onErrorCb(e) } catch (x) { } }
    }.bind(this)
    // Methods
    /**
     * Check is a usb hid from wacom vid+pid is present
     * Note: It seems WebHID needs a positive hid.requestDevice to be allowed to show here and on hid events. do not rely on this for the first connect
     * @returns {Boolean} found a compatible device
     */
    this.checkAvailable = async function () {
        if (this.checkConnected()) return true
        let devices = await navigator.hid.getDevices();
        for (let i = 0; i < devices.length; i++) {
            let device = devices[i]
            if (device.vendorId == this.config.vid && device.productId == this.config.pid)
                return true
        }
        return false
    }.bind(this)
    /**
     * Internal shared setup logic used after a device object is obtained,
     * either via requestDevice() (connect) or getDevices() (connectSilencioso)
     * @returns {Boolean} success
     */
    this._configurarDispositivo = async function () {
        // Open the device (si ya estaba abierto no se vuelve a abrir)
        if (!this.device.opened) await this.device.open()
        this._ultimaImagen = null
        this._pantallaSucia = true
        this.ultimaActividad = Date.now()
        // El escuchador del lápiz se agrega UNA sola vez por dispositivo
        // (antes se duplicaba en cada reconexión y los trazos llegaban repetidos)
        if (this.device.__wacomEscuchando) return await this._leerInformacion()
        this.device.__wacomEscuchando = true
        const self = this
        this.device.addEventListener("inputreport", function (event) {
            self.ultimaActividad = Date.now()
            if (self.config.onPenDataCb == null) return
            if ((event.data.getUint8(0) & 0x02) !== 0) self._pantallaSucia = true   // el lápiz tocó: hay tinta en pantalla
            // See WacomGSS_ReportHandlerFunctionTable on the SDK. just read onPenData and onPenDataTimeCountSequence, depending
            // of the write mode used (0/1). Start/End capture toggles encryption which im not in the mood of implement, so not using it.
            if (event.reportId == this.command.penData || event.reportId == this.command.penDataTiming) {
                let packet = {
                    rdy: (event.data.getUint8(0) & (1 << 0)) !== 0, //Check 1st bit
                    sw: (event.data.getUint8(0) & (1 << 1)) !== 0, //Check 2nd bit
                    cx: Math.trunc(event.data.getUint16(2) / this.config.scaleFactor), //Truncated transformed logic units
                    cy: Math.trunc(event.data.getUint16(4) / this.config.scaleFactor), //Truncated transformed logic units
                    x: event.data.getUint16(2), //Tablet units
                    y: event.data.getUint16(4), //Tablet units
                    press: 0,
                    seq: null,
                    time: null,
                }
                event.data.setUint8(0, event.data.getUint8(0) & 0x0F) //Remove MSB of the 1st byte, todo: maybe i should only clear bits 1,2?
                packet.press = event.data.getUint16(0) / this.config.pressureFactor //Read now as short with cleared MSB
                if (event.reportId == this.command.penDataTiming) {
                    packet.time = event.data.getUint16(6) //Extra timing
                    packet.seq = event.data.getUint16(8) //Extra incremental number
                }
                this.config.onPenDataCb(packet)
            }
        }.bind(this));
        return await this._leerInformacion()
    }.bind(this)
    this._leerInformacion = async function () {
        // Read info and capabilities from device and fill the data
        let dv = await this.readData(this.command.capability)
        this.config.tabletWidth = dv.getUint16(1)
        this.config.tabletHeight = dv.getUint16(3)
        this.config.pressureFactor = dv.getUint16(5)
        this.config.width = dv.getUint16(7)
        this.config.height = dv.getUint16(9)
        this.config.refreshRate = dv.getUint8(11)
        this.config.scaleFactor = this.config.tabletWidth / this.config.width
        // ...leftover info unknown / not needed
        dv = await this.readData(this.command.information)
        this.config.deviceName = this.dataViewString(dv, 1, 7)
        this.config.firmware = dv.getUint8(8) + "." + dv.getUint8(9) + "." + dv.getUint8(10) + "." + dv.getUint8(11)
        // ...leftover info unknown / not needed
        dv = await this.readData(this.command.eSerial)
        this.config.eSerial = this.dataViewString(dv, 1)
        return true
    }.bind(this)
    /**
     * Connect to the device (shows the browser permission picker)
     * @returns {Boolean} success or failure
     */
    this.connect = async function () {
        if (this.checkConnected()) return
        let dev = await navigator.hid.requestDevice({ filters: [{ vendorId: this.config.vid, productId: this.config.pid }] })
        if (dev[0] == null) return false
        this.device = dev[0]
        return await this._configurarDispositivo()
    }.bind(this)
    /**
     * Attempts to reconnect WITHOUT showing the permission picker, using a device
     * previously authorized by the user on this same browser/PC.
     * @returns {Boolean} success or failure (false if never authorized before)
     */
    this.connectSilencioso = async function () {
        if (this.checkConnected()) return true
        let devices = await navigator.hid.getDevices()
        let dev = devices.find(d => d.vendorId == this.config.vid && d.productId == this.config.pid)
        if (dev == null) return false
        this.device = dev
        try {
            return await this._configurarDispositivo()
        } catch (e) {
            this._reportarError(e)
            return false
        }
    }.bind(this)
    /**
     * Comprueba que el pad responde (lectura liviana). No interrumpe una imagen en curso.
     * @returns {Boolean} true si respondió
     */
    this.ping = async function (timeoutMs) {
        if (!this.checkConnected()) return false
        if (this._transfiriendo) return true
        const lectura = this.readData(this.command.brightness).then(function () { return true }, function () { return false })
        const limite = new Promise(function (r) { setTimeout(function () { r(false) }, timeoutMs || 3000) })
        return await Promise.race([lectura, limite])
    }.bind(this)
    /**
     * Cierra la conexión (para reabrir limpio después)
     */
    this.desconectar = async function () {
        const d = this.device
        this.device = null
        this._imagenPendiente = null
        this._ultimaImagen = null
        this._cola = Promise.resolve()     // descarta operaciones colgadas de la conexión anterior
        if (d && d.opened) { try { await d.close() } catch (e) { } }
    }.bind(this)
    /**
     * Obliga a reenviar la próxima imagen aunque sea igual a la actual
     */
    this.invalidarImagen = function () {
        this._ultimaImagen = null
        this._pantallaSucia = true
    }.bind(this)
    /**
     * Retrives general data from the device
     * @returns {Object} info of the device
     */
    this.getTabletInfo = function () {
        if (!this.checkConnected()) return
        return this.config
    }.bind(this)
    /**
     * Set pen color
     * @param {String} color color in '#RRGGBB' format
     * @param {Number} width pen thickness, can be 0-5
     */
    this.setPenColorAndWidth = async function (color, width) {
        if (!this.checkConnected()) return
        let c = color.replace('#', '').split(/(?<=^(?:.{2})+)(?!$)/).map(e => parseInt("0x" + e, 16)) //Converts "#RRGGBB" to Array(r,g,b)
        c.push(parseInt(width)) //Insert width byte, so array now has 4 elements
        await this.sendData(this.command.penColorAndWidth, new Uint8Array(c))
    }.bind(this)
    /**
     * Set backlight intensity, can be 0-3. 
     * Note: it seems its not good to call this frequently.
     * See: http://developer-docs.wacom.com/faqs/docs/q-stu/stu-sdk-application#how-can-i-switch-the-stu-off-when-not-in-use
     */
    this.setBacklight = async function (intensity) {
        if (!this.checkConnected()) return
        // Check if device already has this value, to avoid unnecessary writes
        let dv = null
        try { dv = await this.readData(this.command.brightness) } catch (e) { }
        if (dv && dv.getUint8(1) == intensity) return
        await this.sendData(this.command.brightness, new Uint8Array([intensity, 0]))
    }.bind(this)
    /**
     * Set background color, must clear screen to take effect
     * Note: it seems its not good to call this frequently
     * @param {String} color color in '#RRGGBB' format
     */
    this.setBackgroundColor = async function (color) {
        if (!this.checkConnected()) return
        let c = color.replace('#', '').split(/(?<=^(?:.{2})+)(?!$)/).map(e => parseInt("0x" + e, 16)) //Converts "#RRGGBB" to Array(r,g,b)
        // Check if device already has this value, to avoid unnecessary writes
        let dv = null
        try { dv = await this.readData(this.command.backgroundColor) } catch (e) { }
        if (dv && dv.getUint8(1) == c[0] && dv.getUint8(2) == c[1] && dv.getUint8(3) == c[2]) return
        await this.sendData(this.command.backgroundColor, new Uint8Array(c))
    }.bind(this)
    /**
     * Set writing area of the tablet. 
     * @param {Object} p format {x1:0,x2:0,x1:800,y1:480} where x1,y1=left top and x2,y2=right bottom
     */
    this.setWritingArea = async function (p) {
        if (!this.checkConnected()) return
        let pk = this.makePacket(8)
        pk.view.setUint16(0, p.x1, true)
        pk.view.setUint16(2, p.y1, true)
        pk.view.setUint16(4, p.x2, true)
        pk.view.setUint16(6, p.y2, true)
        await this.sendData(this.command.writingArea, pk.data)
    }.bind(this)
    /**
     * Set writing mode
     * @param {Number} mode 0: basic pen, 1: smooth pen with extra timing data
     */
    this.setWritingMode = async function (mode) {
        if (!this.checkConnected()) return
        await this.sendData(this.command.writingMode, new Uint8Array([mode]))
    }.bind(this)
    /**
     * Enable or disable inking the screen. This does not stop events.
     * @param {Boolean} enabled Status of inking
     */
    this.setInking = async function (enabled) {
        if (!this.checkConnected()) return
        await this.sendData(this.command.inkMode, new Uint8Array([enabled ? 1 : 0]))
    }.bind(this)
    /**
     * Clear screen to background color
     */
    this.clearScreen = async function () {
        if (!this.checkConnected()) return
        await this.sendData(this.command.clearScreen, new Uint8Array([0]))
    }.bind(this)
    /**
     * Send a raw image to the pad.
     * - Si ya se está enviando una imagen, solo se guarda la más reciente y se envía al terminar.
     * - Si la imagen es idéntica a la que el pad ya muestra (y no hay tinta), no se reenvía.
     * - Los paquetes se envían en orden y esperando cada uno (antes se disparaban todos a la vez).
     * @param {Uint8Array} imageData Image must be BGR 24bpp 800x480. If null, it will send last image.
     * @returns {Promise} se resuelve cuando el pad muestra la imagen
     */
    this.setImage = function (imageData) {
        if (!this.checkConnected()) return Promise.resolve()
        if (imageData == null) {
            if (!this._ultimaImagenDatos) return Promise.resolve()
            this._ultimaImagen = null
            imageData = this._ultimaImagenDatos
        }
        this._imagenPendiente = imageData
        if (this._transfiriendo) return this._promesaImagen
        this._transfiriendo = true
        this._promesaImagen = (async function () {
            try {
                while (this._imagenPendiente && this.checkConnected()) {
                    const img = this._imagenPendiente
                    this._imagenPendiente = null
                    if (!this._pantallaSucia && this._ultimaImagen && this._iguales(img, this._ultimaImagen)) continue
                    try {
                        await this._ejecutar(function () { return this._transferirImagen(img) }.bind(this), 60000)
                    } catch (e) { this._ultimaImagen = null; this._reportarError(e) }
                }
            } finally {
                this._transfiriendo = false
            }
        }.bind(this))()
        return this._promesaImagen
    }.bind(this)
    /**
     * (Experimental) Escribe solo un rectángulo de la pantalla (reporte 0x22, "image data area"
     * del protocolo STU-530/540). Mucho menos datos que la pantalla completa.
     * Prioridad baja: si hay una pantalla completa pendiente o enviándose, el cuadro se descarta.
     * x2/y2 son inclusivos. Si el pad rechaza el reporte, marca areaNoSoportada = true.
     * @returns {Promise<Boolean>} true si se envió
     */
    this.areaNoSoportada = false
    this._areaEnCurso = false
    this.setImageArea = function (data, x1, y1, x2, y2) {
        if (!this.checkConnected() || this.areaNoSoportada) return Promise.resolve(false)
        if (this._transfiriendo || this._imagenPendiente || this._areaEnCurso) return Promise.resolve(false)
        this._areaEnCurso = true
        const self = this
        return this._ejecutar(async function () {
            const dispositivo = self.device
            const cab = new Uint8Array(9), dv = new DataView(cab.buffer)
            cab[0] = self.config.imageFormat24BGR
            dv.setUint16(1, x1, true); dv.setUint16(3, y1, true); dv.setUint16(5, x2, true); dv.setUint16(7, y2, true)
            try {
                await dispositivo.sendFeatureReport(0x22, cab)
            } catch (e) {
                self.areaNoSoportada = true
                return false
            }
            const tam = self.config.chunkSize
            const total = Math.ceil(data.length / tam)
            for (let i = 0; i < total; i++) {
                if (self.device !== dispositivo || !dispositivo.opened) throw new Error('Conexión cerrada durante el envío')
                if (self._imagenPendiente) break                 // llegó una pantalla real: se corta la animación
                const trozo = data.subarray(i * tam, Math.min((i + 1) * tam, data.length))
                const pk = new Uint8Array(tam + 2)
                pk[0] = trozo.length
                pk.set(trozo, 2)
                await dispositivo.sendFeatureReport(self.command.writeImageData, pk)
            }
            await dispositivo.sendFeatureReport(self.command.writeImageEnd, new Uint8Array([0]))
            self._ultimaImagen = null             // la pantalla ya no es igual a la última imagen completa
            self.ultimaActividad = Date.now()
            return true
        }, 20000).catch(function (e) { self._reportarError(e); return false })
          .finally(function () { self._areaEnCurso = false })
    }.bind(this)
    this._iguales = function (a, b) {
        if (a.length !== b.length) return false
        for (let i = 0; i < a.length; i += 3) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return false
        return true
    }
    this._transferirImagen = async function (img) {
        if (!this.checkConnected()) return
        const tam = this.config.chunkSize
        const total = Math.ceil(img.length / tam)
        const progreso = this.config.onImageProgressCb
        try {
            this._pantallaSucia = false
            if (progreso) progreso(0, total)
            await this.device.sendFeatureReport(this.command.writeImageStart, new Uint8Array([this.config.imageFormat24BGR]))
            const dispositivo = this.device
            for (let i = 0; i < total; i++) {
                if (this.device !== dispositivo || !dispositivo.opened) throw new Error('Conexión cerrada durante el envío')
                const ini = i * tam
                const trozo = img.subarray(ini, Math.min(ini + tam, img.length))
                const pk = new Uint8Array(tam + 2)
                pk[0] = trozo.length
                pk.set(trozo, 2)
                await dispositivo.sendFeatureReport(this.command.writeImageData, pk)
                if (progreso && (i & 127) === 0) progreso(i, total)
            }
            await this.device.sendFeatureReport(this.command.writeImageEnd, new Uint8Array([0]))
            this._ultimaImagen = img
            this._ultimaImagenDatos = img
            this.ultimaActividad = Date.now()
        } catch (e) {
            this._ultimaImagen = null
            this._reportarError(e)
        } finally {
            if (progreso) progreso(total, total)
        }
    }.bind(this)
    // Helpers
    /**
     * Check if theres a device connected
     * @returns {Boolean} connection status
     */
    this.checkConnected = function () {
        return this.device != null && this.device.opened
    }.bind(this)
    /**
     * Send direct usb hid feature report (internal usage)
     * @param {Number} reportId ID of the report to read. Use one of this.command
     */
    this.sendData = function (reportId, data) {
        if (!this.checkConnected()) return Promise.resolve()
        return this._ejecutar(async function () {
            if (!this.checkConnected()) return
            try {
                await this.device.sendFeatureReport(reportId, data)
                this.ultimaActividad = Date.now()
            } catch (e) { this._reportarError(e) }
        }.bind(this))
    }.bind(this)
    /**
     * Get a report from the device (internal usage)
     * @param {Number} reportId ID of the report to read. Use one of this.command
     * @returns {DataView} data returned or null
     */
    this.readData = function (reportId) {
        if (!this.checkConnected()) return Promise.resolve()
        return this._ejecutar(async function () {
            if (!this.checkConnected()) throw new Error('Pad no conectado')
            try {
                const r = await this.device.receiveFeatureReport(reportId)
                this.ultimaActividad = Date.now()
                return r
            } catch (e) { this._reportarError(e); throw e }
        }.bind(this))
    }.bind(this)
    /**
     * Return an object containing an array of (len) bytes and a DataView for manipulation
     * (internal usage)
     * @param {any} len size in bytes of the packet
     */
    this.makePacket = function (len) {
        let p = new Uint8Array(len)
        let v = new DataView(p.buffer)
        return { data: p, view: v }
    }
    /**
     * Truncates a long array (arr) into smaller arrays of bulkSize 
     * (into an array, last item's length could be less than bulkSize)
     * (internal usage)
     * @param {Array} arr Array or derivated type containing full image data
     * @param {Number} bulkSize size of the resulting subarrays
     * @returns {Array} Array of arrays containing data splitted
     */
    this.splitToBulks = function (arr, bulkSize) {
        const bulks = []
        for (let i = 0; i < Math.ceil(arr.length / bulkSize); i++) {
            var a = Array(bulkSize)
            for (var x = i * bulkSize, z = 0; x < (i + 1) * bulkSize; x++, z++)
                a[z] = arr[x]
            bulks.push(a)
        }
        return bulks
    }
    /**
     * Obtains an ASCII string from DataView
     * @param {DataView} dv DataView to read
     * @param {Number} offset Position to start
     * @param {Number} length Optional end of string
     * @returns {String} String result
     */
    this.dataViewString = function (dv, offset, length) {
        var end = typeof length == 'number' ? offset + length : dv.byteLength, text = '', val = -1
        while (offset < dv.byteLength && offset < end) {
            val = dv.getUint8(offset++)
            if (val == 0) break
            text += String.fromCharCode(val)
        }
        return text
    }
    // Event handlers
    /**
     * Set the data callback for pen events.
     * @param {Function} func Callback function recives an object:
     * -------------------------------------------------------------------------
     *   	rdy: 	Returns TRUE if the pen is in proximity with the tablet
     *   	sw:  	Returns TRUE if the pen is in contact with the surface
     *   	press: 	Returns pen pressure in tablet units (0-1024)
     *   	cx:     Transformed x
     *   	cy:     Transformed y
     *   	x: 	    Point in X in tablet scale (*13.5)
     *   	y: 	    Point in Y in tablet scale (*13.5)
     *   	time: 	(Only for writingMode=1) timestamp
     *   	seq:  	(Only for writingMode=1) incremental number
     */
    this.onPenData = function (func) {
        this.config.onPenDataCb = func
    }.bind(this)
    /**
     * Set the callback for HID connect and disconnect events from devices matching wacom stu
     * @param {Function} func Callback function recives ("connect/disconnect", hidDeviceObject)
     */
    this.onHidChange = function (func) {
        this.config.onHidChangeCb = func
    }.bind(this)
    /**
     * Callback de errores de comunicación (para reconectar)
     */
    this.onError = function (func) {
        this.config.onErrorCb = func
    }.bind(this)
    /**
     * Callback de progreso al enviar una imagen: func(enviados, total)
     */
    this.onImageProgress = function (func) {
        this.config.onImageProgressCb = func
    }.bind(this)
    // HID events
    navigator.hid.addEventListener("connect", function (e) {
        if (this.config.onHidChangeCb != null && e.device.vendorId == this.config.vid && e.device.productId == this.config.pid)
            this.config.onHidChangeCb('connect', e.device)
    }.bind(this))
    navigator.hid.addEventListener("disconnect", function (e) {
        if (this.device && e.device === this.device) { this._imagenPendiente = null; this._ultimaImagen = null }
        if (this.config.onHidChangeCb != null && e.device.vendorId == this.config.vid && e.device.productId == this.config.pid)
            this.config.onHidChangeCb('disconnect', e.device)
    }.bind(this))
    return this
}
