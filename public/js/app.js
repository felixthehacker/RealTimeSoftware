class MonitorFrontend {
    constructor() {
        this.socket = io();
        this.initializeEventListeners();
        this.setupSocketEvents();
        this.loadInitialState();
        this.loadTimeZoneInfo();
    }

    initializeEventListeners() {
        // Tabs
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Botones de control
        document.getElementById('btnIniciar').addEventListener('click', () => {
            this.toggleMonitoreo();
        });

        document.getElementById('btnActualizarPozo').addEventListener('click', () => {
            this.actualizarDatosPozo();
        });

        document.getElementById('btnAplicarRetraso').addEventListener('click', () => {
            this.actualizarRetraso();
        });

        document.getElementById('btnLimpiar').addEventListener('click', () => {
            this.limpiarRegistro();
        });

        // Búsqueda manual
        document.getElementById('btnBuscarManual').addEventListener('click', () => {
            this.buscarManual();
        });

        document.getElementById('btnGuardarManual').addEventListener('click', () => {
            this.guardarManual();
        });

        // Enter en búsqueda manual
        document.getElementById('entryHoraManual').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.buscarManual();
            }
        });

        // Botón información zona horaria
        document.getElementById('btnInfoZonaHoraria').addEventListener('click', () => {
            this.mostrarInfoZonaHoraria();
        });
    }

    setupSocketEvents() {
        this.socket.on('estado_actual', (data) => {
            this.actualizarEstado(data);
        });

        this.socket.on('monitoreo_iniciado', (data) => {
            this.mostrarMonitoreoIniciado(data);
        });

        this.socket.on('monitoreo_detenido', () => {
            this.mostrarMonitoreoDetenido();
        });

        this.socket.on('sincronizando', (data) => {
            this.mostrarSincronizando(data);
        });

        this.socket.on('sincronizado', (data) => {
            this.mostrarSincronizado(data);
        });

        this.socket.on('nuevo_registro', (data) => {
            this.mostrarNuevoRegistro(data);
        });

        // Estado de conexión
        this.socket.on('connect', () => {
            this.actualizarEstadoConexion(true);
        });

        this.socket.on('disconnect', () => {
            this.actualizarEstadoConexion(false);
        });
    }

    async loadInitialState() {
        try {
            const response = await fetch('/api/estado');
            const data = await response.json();
            this.actualizarEstado(data);
        } catch (error) {
            console.error('Error cargando estado inicial:', error);
        }
    }

    async loadTimeZoneInfo() {
        try {
            const response = await fetch('/api/info-zona-horaria');
            const data = await response.json();
            
            // Actualizar información de zona horaria en la UI
            const timezoneInfo = document.getElementById('timezoneInfo');
            if (timezoneInfo) {
                timezoneInfo.innerHTML = `
                    <i class="fas fa-clock"></i> 
                    Zona: Venezuela (UTC-4:30) | 
                    Hora servidor: ${data.hora_venezuela}
                `;
            }
        } catch (error) {
            console.error('Error cargando información de zona horaria:', error);
        }
    }

    switchTab(tabName) {
        // Ocultar todas las pestañas
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        
        // Mostrar pestaña seleccionada
        document.getElementById(tabName).classList.add('active');
        
        // Actualizar botones de pestañas
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.remove('active');
        });
        
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    }

    async toggleMonitoreo() {
        const btn = document.getElementById('btnIniciar');
        const estaMonitoreando = btn.textContent.includes('Detener');

        try {
            const endpoint = estaMonitoreando ? '/api/detener-monitoreo' : '/api/iniciar-monitoreo';
            const response = await fetch(endpoint, { method: 'POST' });
            const data = await response.json();
            
            if (data.success) {
                this.mostrarMensaje(data.message, 'success');
            }
        } catch (error) {
            this.mostrarMensaje('Error al cambiar estado del monitoreo', 'error');
        }
    }

    async actualizarDatosPozo() {
        try {
            const response = await fetch('/api/actualizar-datos-pozo', { method: 'POST' });
            const data = await response.json();
            
            this.mostrarMensaje(data.message, data.success ? 'success' : 'error');
        } catch (error) {
            this.mostrarMensaje('Error al actualizar datos del pozo', 'error');
        }
    }

    async actualizarRetraso() {
        const retraso = document.getElementById('spinRetraso').value;
        this.mostrarMensaje(`Retraso configurado a ${retraso} segundos`, 'info');
    }

    limpiarRegistro() {
        document.getElementById('textResultados').textContent = '';
        this.mostrarMensaje('Registro limpiado. Buscando nuevo registro...', 'info');
    }

    async buscarManual() {
        const hora = document.getElementById('entryHoraManual').value.trim();
        
        if (!hora) {
            this.mostrarMensaje('Por favor ingrese una hora para buscar', 'warning');
            return;
        }

        if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(hora)) {
            this.mostrarMensaje('Formato de hora incorrecto. Use HH:MM:SS', 'warning');
            return;
        }

        try {
            const response = await fetch(`/api/buscar-manual/${hora}`);
            const data = await response.json();
            
            const output = document.getElementById('textManual');
            output.textContent = '';
            
            if (data.success && data.datos.length > 0) {
                output.textContent = this.formatearRegistro(data.datos[0], hora);
            } else {
                output.textContent = `No se encontraron registros para la hora: ${hora}`;
            }
        } catch (error) {
            this.mostrarMensaje('Error en la búsqueda manual', 'error');
        }
    }

    async guardarManual() {
        const hora = document.getElementById('entryHoraManual').value.trim();
        
        if (!hora) {
            this.mostrarMensaje('No hay hora especificada para guardar', 'warning');
            return;
        }

        this.mostrarMensaje('Función de guardado manual en desarrollo', 'info');
    }

    async mostrarInfoZonaHoraria() {
        try {
            const response = await fetch('/api/info-zona-horaria');
            const data = await response.json();
            
            let mensaje = `ℹ️ Información de Zona Horaria:\n`;
            mensaje += `Zona: ${data.zona_actual}\n`;
            mensaje += `Offset: ${data.offset}\n`;
            mensaje += `Hora Venezuela: ${data.hora_venezuela}\n`;
            mensaje += `Hora UTC: ${data.hora_utc}\n`;
            mensaje += `Tabla actual: ${data.tabla_actual}`;
            
            this.mostrarMensaje(mensaje, 'info');
        } catch (error) {
            this.mostrarMensaje('Error obteniendo información de zona horaria', 'error');
        }
    }

    actualizarEstado(data) {
        // Actualizar estado del monitoreo
        const statusBar = document.getElementById('statusBar');
        const btnIniciar = document.getElementById('btnIniciar');
        
        if (data.monitoreando) {
            statusBar.innerHTML = `
                <span class="status status-monitoring">
                    <i class="fas fa-circle"></i> MONITOREANDO
                </span>
                <span class="table-info">Tabla: ${data.tabla_actual}</span>
                <span class="timezone-info">Zona: Venezuela (UTC-4:30) | Hora: ${data.hora_actual}</span>
            `;
            btnIniciar.innerHTML = '<i class="fas fa-stop"></i> Detener Monitoreo';
        } else {
            statusBar.innerHTML = `
                <span class="status status-stopped">
                    <i class="fas fa-circle"></i> MONITOREO DETENIDO
                </span>
                <span class="table-info">Tabla: ${data.tabla_actual}</span>
                <span class="timezone-info">Zona: Venezuela (UTC-4:30) | Hora: ${data.hora_actual}</span>
            `;
            btnIniciar.innerHTML = '<i class="fas fa-play"></i> Iniciar Monitoreo';
        }

        // Actualizar estadísticas
        document.getElementById('totalGuardados').textContent = 
            `Registros guardados: ${data.total_guardados}`;
            
        document.getElementById('tableInfo').textContent = 
            `Tabla: ${data.tabla_actual}`;
    }

    mostrarMonitoreoIniciado(data) {
        const zona = data?.zona_horaria ? ` (${data.zona_horaria})` : '';
        this.mostrarMensaje(`Monitoreo iniciado${zona} - Sincronizando...`, 'info');
    }

    mostrarMonitoreoDetenido() {
        this.mostrarMensaje('Monitoreo detenido', 'warning');
    }

    mostrarSincronizando(data) {
        const syncInfo = document.getElementById('syncInfo');
        syncInfo.className = 'sync-info sync-waiting';
        const zona = data?.zona_horaria ? ` [${data.zona_horaria}]` : '';
        syncInfo.innerHTML = `
            <i class="fas fa-sync fa-spin"></i>
            Sincronizando${zona} - Esperando ${data.proximo_multiplo}
            (${data.esperando.toFixed(1)}s)
        `;
    }

    mostrarSincronizado(data) {
        const syncInfo = document.getElementById('syncInfo');
        syncInfo.className = 'sync-info sync-ready';
        const zona = data?.zona_horaria ? ` [${data.zona_horaria}]` : '';
        syncInfo.innerHTML = `
            <i class="fas fa-check-circle"></i>
            Sincronizado con múltiplos de 5 segundos${zona} - Tabla: ${data.tabla}
        `;
    }

    mostrarNuevoRegistro(data) {
        const output = document.getElementById('textResultados');
        
        let contenido = `=== MONITOREO EN TIEMPO REAL ===\n`;
        contenido += `Zona horaria: ${data.zona_horaria || 'Venezuela (UTC-4:30)'}\n`;
        contenido += `Fecha: ${new Date().toLocaleDateString('es-VE')}\n`;
        contenido += `Hora actual Venezuela: ${data.hora_actual}\n`;
        contenido += `Tabla: ${data.tabla}\n`;
        contenido += `Registro de: ${data.hora}\n`;
        contenido += `Estado: ${data.guardado ? 'GUARDADO ✓' : 'DUPLICADO'}\n`;
        contenido += `Conexiones: Lectura[✓], Escritura[✓]\n`;
        contenido += '='.repeat(50) + '\n\n';
        
        if (data.registro) {
            contenido += `>>> REGISTRO - Hora: ${data.hora}\n`;
            contenido += `Estado: REGISTRO ACTUAL ✓\n`;
            
            // Mostrar columnas importantes
            const columnasMostrar = ['HOOKLOAD', 'PUMPPR', 'FLOWOUT', 'GASTOTAL', 'TORQUE', 'DEPTHMD', 'WOB', 'ROP'];
            columnasMostrar.forEach(columna => {
                if (data.registro[columna] !== undefined) {
                    contenido += `  ${columna}: ${data.registro[columna]}\n`;
                }
            });
            
            contenido += `... y ${Object.keys(data.registro).length - columnasMostrar.length} columnas más\n`;
            contenido += '-'.repeat(50) + '\n\n';
        }
        
        contenido += `Última actualización: ${data.hora_actual}\n`;
        
        output.textContent = contenido;
        
        // Actualizar estadísticas en footer
        document.getElementById('ultimaActualizacion').textContent = 
            `Última actualización: ${data.hora_actual}`;
    }

    formatearRegistro(registro, hora) {
        let contenido = `=== REGISTRO ENCONTRADO ===\n`;
        contenido += `Hora: ${hora}\n`;
        contenido += `Tabla: ${this.getCurrentTableName()}\n`;
        contenido += `Zona horaria: Venezuela (UTC-4:30)\n`;
        contenido += '-'.repeat(50) + '\n';
        
        for (const [columna, valor] of Object.entries(registro)) {
            contenido += `${columna}: ${valor}\n`;
        }
        
        contenido += '\n[Use el botón "Guardar Manualmente" para guardar este registro]\n';
        
        return contenido;
    }

    getCurrentTableName() {
        // Obtener nombre de tabla actual usando hora de Venezuela
        const now = new Date();
        // Ajustar a UTC-4:30
        const adjustedTime = new Date(now.getTime() - (4.5 * 60 * 60 * 1000));
        const day = String(adjustedTime.getUTCDate()).padStart(2, '0');
        const month = String(adjustedTime.getUTCMonth() + 1).padStart(2, '0');
        const year = String(adjustedTime.getUTCFullYear()).slice(-2);
        return `tiempo${day}${month}${year}`;
    }

    actualizarEstadoConexion(conectado) {
        const estado = conectado ? 'connected' : 'disconnected';
        const texto = conectado ? 'Conectado' : 'Desconectado';
        
        document.querySelectorAll('.conn-text').forEach(element => {
            element.className = `conn-text ${estado}`;
            element.textContent = texto;
        });
    }

    mostrarMensaje(mensaje, tipo) {
        // Implementación simple de notificación
        console.log(`[${tipo.toUpperCase()}] ${mensaje}`);
        
        // Podrías integrar aquí una librería de notificaciones como Toastify
        alert(`[${tipo.toUpperCase()}] ${mensaje}`);
    }
}

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    new MonitorFrontend();
});