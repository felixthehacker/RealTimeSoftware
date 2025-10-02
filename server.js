const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
const moment = require('moment');
const path = require('path');

class MonitorTiempoReal {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server);
        
        this.monitoreando = false;
        this.retraso_segundos = 5;
        this.ultimo_registro = null;
        this.ultima_hora_registro = null;
        this.registros_guardados = new Set();
        this.tabla_lectura_actual = this.obtener_nombre_tabla_actual();
        
        // Configurar offset manual para Venezuela (UTC-4:30)
        this.offset_venezuela = -4.5; // UTC-4:30 en horas decimales
        
        // Conexiones a BD
        this.conexion_lectura = null;
        this.conexion_escritura = null;
        
        this.configurarServidor();
        this.configurarSocketIO();
        this.inicializarConexiones();
    }

    configurarServidor() {
        this.app.use(express.static(path.join(__dirname, 'public')));
        this.app.use(express.json());
        
        // Rutas API
        this.app.get('/api/estado', (req, res) => {
            res.json({
                monitoreando: this.monitoreando,
                tabla_actual: this.tabla_lectura_actual,
                ultimo_registro: this.ultima_hora_registro,
                total_guardados: this.registros_guardados.size,
                zona_horaria: 'Venezuela (UTC-4:30)',
                hora_actual: this.obtener_hora_actual_venezuela().format('HH:mm:ss')
            });
        });

        this.app.post('/api/iniciar-monitoreo', (req, res) => {
            this.iniciarMonitoreo();
            res.json({ success: true, message: 'Monitoreo iniciado' });
        });

        this.app.post('/api/detener-monitoreo', (req, res) => {
            this.detenerMonitoreo();
            res.json({ success: true, message: 'Monitoreo detenido' });
        });

        this.app.get('/api/buscar-manual/:hora', async (req, res) => {
            try {
                const resultados = await this.buscarRegistroManual(req.params.hora);
                res.json({ success: true, datos: resultados });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        this.app.post('/api/actualizar-datos-pozo', async (req, res) => {
            try {
                const success = await this.actualizarDatosPozo();
                res.json({ success, message: success ? 'Datos actualizados' : 'Error al actualizar' });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // Nueva ruta para información de zona horaria
        this.app.get('/api/info-zona-horaria', (req, res) => {
            const ahoraVenezuela = this.obtener_hora_actual_venezuela();
            const ahoraUTC = moment().utc();
            
            res.json({
                zona_actual: 'Venezuela',
                offset: 'UTC-4:30',
                offset_decimal: -4.5,
                hora_venezuela: ahoraVenezuela.format('YYYY-MM-DD HH:mm:ss'),
                hora_utc: ahoraUTC.format('YYYY-MM-DD HH:mm:ss'),
                tabla_actual: this.tabla_lectura_actual,
                timestamp: Date.now()
            });
        });
    }

    configurarSocketIO() {
        this.io.on('connection', (socket) => {
            console.log('Cliente conectado:', socket.id);

            // Enviar estado actual al cliente
            socket.emit('estado_actual', {
                monitoreando: this.monitoreando,
                tabla_actual: this.tabla_lectura_actual,
                ultimo_registro: this.ultimo_registro,
                zona_horaria: 'Venezuela (UTC-4:30)',
                hora_actual: this.obtener_hora_actual_venezuela().format('HH:mm:ss')
            });

            socket.on('disconnect', () => {
                console.log('Cliente desconectado:', socket.id);
            });
        });
    }

    async inicializarConexiones() {
        try {
            await this.configurarConexionesPersistentes();
            await this.cargarDatosPozo();
            console.log('✅ Sistema inicializado correctamente');
            console.log('📍 Zona horaria configurada: Venezuela (UTC-4:30)');
            console.log(`🕐 Hora actual Venezuela: ${this.obtener_hora_actual_venezuela().format('HH:mm:ss')}`);
        } catch (error) {
            console.error('❌ Error inicializando sistema:', error);
        }
    }

    async configurarConexionesPersistentes() {
        try {
            // Conexión local
            this.conexion_lectura = mysql.createPool({
                host: "localhost",
                user: "admin",
                password: "12345678",
                database: "aveco1",
                charset: 'utf8',
                connectionLimit: 10
            });

            // Conexión remota
            this.conexion_escritura = mysql.createPool({
                host: 'srv934.hstgr.io',
                user: 'u555296241_Softronica',
                password: '6G8YhmLRz[',
                database: 'u555296241_Realtime',
                charset: 'utf8',
                connectionLimit: 10
            });

            console.log('✅ Conexiones a BD establecidas');
        } catch (error) {
            console.error('❌ Error conectando a BD:', error);
            throw error;
        }
    }

    obtener_hora_actual_venezuela() {
        // Aplicar offset manual de UTC-4:30 (4 horas y 30 minutos)
        return moment().utc().subtract(4, 'hours').subtract(30, 'minutes');
    }

    obtener_nombre_tabla_actual() {
        // Usar hora de Venezuela para el nombre de la tabla
        return `tiempo${this.obtener_hora_actual_venezuela().format('DDMMYY')}`;
    }

    calcular_proximo_multiplo_5() {
        const ahora = this.obtener_hora_actual_venezuela();
        const segundos_actuales = ahora.second();
        const segundos_restantes = 5 - (segundos_actuales % 5);
        
        const tiempo_espera = segundos_restantes === 5 ? 0 : segundos_restantes;
        const proximo_multiplo = ahora.clone().add(segundos_restantes, 'seconds').second(0);
        
        return { tiempo_espera, proximo_multiplo };
    }

    calcular_hora_consulta_sincronizada() {
        const ahora = this.obtener_hora_actual_venezuela();
        const segundos_redondeados = Math.floor(ahora.second() / 5) * 5;
        const hora_redondeada = ahora.clone().second(segundos_redondeados).millisecond(0);
        const hora_con_retraso = hora_redondeada.subtract(this.retraso_segundos, 'seconds');
        
        return hora_con_retraso.format('HH:mm:ss');
    }

    async buscarRegistroRetrasado() {
        const hora_consulta = this.calcular_hora_consulta_sincronizada();
        const hora_actual_venezuela = this.obtener_hora_actual_venezuela().format('HH:mm:ss');
        
        try {
            const [resultados] = await this.conexion_lectura.execute(
                `SELECT * FROM ${this.tabla_lectura_actual} WHERE HORA = ?`,
                [hora_consulta]
            );

            if (resultados.length > 0) {
                this.ultimo_registro = resultados[0];
                this.ultima_hora_registro = hora_consulta;
                
                // Guardar en BD remota
                const guardado = await this.guardarRegistro(this.ultimo_registro, hora_consulta);
                
                // Emitir a todos los clientes
                this.io.emit('nuevo_registro', {
                    registro: this.ultimo_registro,
                    hora: hora_consulta,
                    hora_actual: hora_actual_venezuela,
                    guardado: guardado,
                    tabla: this.tabla_lectura_actual,
                    zona_horaria: 'Venezuela (UTC-4:30)'
                });

                console.log(`✅ Registro encontrado y ${guardado ? 'guardado' : 'duplicado'}: ${hora_consulta} (Hora Venezuela: ${hora_actual_venezuela})`);
            } else {
                console.log(`⚠️ No se encontró registro para: ${hora_consulta} (Hora Venezuela: ${hora_actual_venezuela})`);
            }
        } catch (error) {
            console.error('❌ Error buscando registro:', error);
        }
    }

    async guardarRegistro(registro, hora_consulta) {
        const clave_unica = `${hora_consulta}_${registro.ID || ''}`;
        
        if (this.registros_guardados.has(clave_unica)) {
            return false;
        }

        try {
            // Verificar si ya existe en BD remota
            const [existe] = await this.conexion_escritura.execute(
                'SELECT COUNT(*) as count FROM tiempo WHERE HORA = ?',
                [hora_consulta]
            );

            if (existe[0].count > 0) {
                this.registros_guardados.add(clave_unica);
                return false;
            }

            // Obtener columnas de la tabla destino
            const [columnas] = await this.conexion_escritura.execute('DESCRIBE tiempo');
            const nombres_columnas = columnas.map(col => col.Field);
            
            // Filtrar columnas comunes
            const columnas_comunes = [];
            const valores = [];
            
            for (const [columna, valor] of Object.entries(registro)) {
                if (nombres_columnas.includes(columna)) {
                    columnas_comunes.push(columna);
                    valores.push(valor);
                }
            }

            if (columnas_comunes.length === 0) {
                return false;
            }

            // Insertar registro
            const placeholders = columnas_comunes.map(() => '?').join(', ');
            const consulta = `INSERT INTO tiempo (${columnas_comunes.join(', ')}) VALUES (${placeholders})`;
            
            await this.conexion_escritura.execute(consulta, valores);
            this.registros_guardados.add(clave_unica);
            
            return true;
        } catch (error) {
            console.error('❌ Error guardando registro:', error);
            return false;
        }
    }

    async cargarDatosPozo() {
        try {
            const [datos_pozo] = await this.conexion_lectura.execute('SELECT * FROM datos LIMIT 1');
            
            if (datos_pozo.length > 0) {
                const success = await this.enviarActualizarDatosPozo(datos_pozo[0]);
                console.log(success ? '✅ Datos del pozo cargados' : '❌ Error cargando datos del pozo');
            }
        } catch (error) {
            console.error('❌ Error cargando datos del pozo:', error);
        }
    }

    async enviarActualizarDatosPozo(datos_pozo) {
        try {
            const [existe] = await this.conexion_escritura.execute('SELECT COUNT(*) as count FROM datos');
            
            if (existe[0].count > 0) {
                // Actualizar
                await this.conexion_escritura.execute(
                    `UPDATE datos SET LOCACION=?, BLOQUE=?, TALADRO=?, OPERADORA=?, 
                     COORDENADASN=?, COORDENADASE=?, ESTADOPAIS=?, GEOLOGO=?, 
                     EMR=?, ET=?, OPERADORES=?, TUBOSPORPAREJA=? WHERE POZO=?`,
                    [
                        datos_pozo.LOCACION, datos_pozo.BLOQUE, datos_pozo.TALADRO,
                        datos_pozo.OPERADORA, datos_pozo.COORDENADASN, datos_pozo.COORDENADASE,
                        datos_pozo.ESTADOPAIS, datos_pozo.GEOLOGO, datos_pozo.EMR,
                        datos_pozo.ET, datos_pozo.OPERADORES, datos_pozo.TUBOSPORPAREJA,
                        datos_pozo.POZO
                    ]
                );
            } else {
                // Insertar
                await this.conexion_escritura.execute(
                    `INSERT INTO datos (POZO, LOCACION, BLOQUE, TALADRO, OPERADORA, 
                     COORDENADASN, COORDENADASE, ESTADOPAIS, GEOLOGO, EMR, ET, OPERADORES, TUBOSPORPAREJA)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        datos_pozo.POZO, datos_pozo.LOCACION, datos_pozo.BLOQUE,
                        datos_pozo.TALADRO, datos_pozo.OPERADORA, datos_pozo.COORDENADASN,
                        datos_pozo.COORDENADASE, datos_pozo.ESTADOPAIS, datos_pozo.GEOLOGO,
                        datos_pozo.EMR, datos_pozo.ET, datos_pozo.OPERADORES, datos_pozo.TUBOSPORPAREJA
                    ]
                );
            }
            
            return true;
        } catch (error) {
            console.error('❌ Error actualizando datos del pozo:', error);
            return false;
        }
    }

    async actualizarDatosPozo() {
        return await this.cargarDatosPozo();
    }

    async buscarRegistroManual(hora) {
        const [resultados] = await this.conexion_lectura.execute(
            `SELECT * FROM ${this.tabla_lectura_actual} WHERE HORA = ?`,
            [hora]
        );
        return resultados;
    }

    async monitorear() {
        let sincronizado = false;
        
        while (this.monitoreando) {
            try {
                if (!sincronizado) {
                    const { tiempo_espera, proximo_multiplo } = this.calcular_proximo_multiplo_5();
                    
                    this.io.emit('sincronizando', {
                        esperando: tiempo_espera,
                        proximo_multiplo: proximo_multiplo.format('HH:mm:ss'),
                        zona_horaria: 'Venezuela (UTC-4:30)'
                    });

                    if (tiempo_espera > 0) {
                        await new Promise(resolve => setTimeout(resolve, tiempo_espera * 1000));
                    }
                    
                    sincronizado = true;
                    this.io.emit('sincronizado', { 
                        tabla: this.tabla_lectura_actual,
                        zona_horaria: 'Venezuela (UTC-4:30)'
                    });
                }

                await this.buscarRegistroRetrasado();

                // Esperar hasta el próximo múltiplo de 5
                const { tiempo_espera } = this.calcular_proximo_multiplo_5();
                if (tiempo_espera > 0) {
                    await new Promise(resolve => setTimeout(resolve, tiempo_espera * 1000));
                }
            } catch (error) {
                console.error('❌ Error en monitoreo:', error);
                sincronizado = false;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    iniciarMonitoreo() {
        if (!this.monitoreando) {
            this.monitoreando = true;
            this.monitorear();
            console.log('🚀 Monitoreo iniciado - Zona horaria: Venezuela (UTC-4:30)');
            this.io.emit('monitoreo_iniciado', { zona_horaria: 'Venezuela (UTC-4:30)' });
        }
    }

    detenerMonitoreo() {
        this.monitoreando = false;
        console.log('🛑 Monitoreo detenido');
        this.io.emit('monitoreo_detenido');
    }

    iniciarServidor(puerto = 3000) {
        this.server.listen(puerto, () => {
            console.log(`🎯 Servidor ejecutándose en http://localhost:${puerto}`);
            console.log(`📍 Zona horaria: Venezuela (UTC-4:30)`);
            console.log(`🕐 Hora actual Venezuela: ${this.obtener_hora_actual_venezuela().format('HH:mm:ss')}`);
        });
    }
}

// Inicializar y ejecutar servidor
const monitor = new MonitorTiempoReal();
monitor.iniciarServidor(3000);