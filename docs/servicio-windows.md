# Nebula como servicio de Windows

Guía para instalar, gestionar y quitar Nebula como servicio con [NSSM](https://nssm.cc). Un servicio arranca con el equipo, corre en segundo plano y se relanza solo si se cae.

> Es opcional. Si solo usas Nebula de vez en cuando, basta con `npm start`.

## Requisitos

- Node 22 o superior y FFmpeg (`ffmpeg` y `ffprobe`) accesibles desde el PATH.
- NSSM: `winget install NSSM.NSSM` (abre una terminal nueva después).
- El proyecto preparado: `npm install` y `npm run build`.
- Un archivo `.env` con tu configuración (copia `.env.example`). El servicio lo lee al arrancar.

## Instalar

En PowerShell **como administrador**, desde la carpeta del proyecto:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\instalar-servicio.ps1
```

Crea el servicio «Nebula», lo pone en arranque automático, lo inicia y guarda el registro en `data\nebula.log` (rota a los 10 MB).

## Día a día

Todos los comandos, en PowerShell como administrador:

| Qué | Comando |
| --- | --- |
| Ver el estado | `nssm status Nebula` |
| Parar | `nssm stop Nebula` |
| Arrancar | `nssm start Nebula` |
| Reiniciar | `nssm restart Nebula` |
| Ver el registro en vivo | `Get-Content data\nebula.log -Wait -Tail 50` |

También puedes gestionarlo desde `services.msc`.

## Cambiar la configuración

Edita `.env` y reinicia: `nssm restart Nebula`. Los cambios no se aplican hasta reiniciar.

## Actualizar Nebula

```powershell
nssm stop Nebula
git pull
npm install
npm run build
nssm start Nebula
```

La base de datos y las carátulas están en `data\`, que no se toca al actualizar.

## Si algo falla

- **No arranca:** mira las últimas líneas de `data\nebula.log`. Lo más habitual es un puerto ocupado (cambia `PORT` en `.env`) o una ruta de `.env` mal escrita.
- **«Falta frontend\dist»:** ejecuta `npm run build`.
- **No convierte vídeo / sin GPU:** un servicio corre con otra cuenta y puede no ver el mismo PATH que tú. Indica la ruta completa en `.env` (`FFMPEG_PATH`, `FFPROBE_PATH`) y ejecuta `npm run doctor` para diagnosticarlo.
- **No ve tus carpetas:** el servicio corre como «Sistema» por defecto, que no tiene acceso a discos de red ni a unidades mapeadas. Usa rutas locales o, para red, cambia la cuenta con `nssm set Nebula ObjectName .\TuUsuario TuContraseña`.
- **Se reinicia en bucle:** `nssm set Nebula AppThrottle 10000` evita que NSSM lo relance sin pausa mientras investigas.

## Quitar el servicio

```powershell
nssm stop Nebula
nssm remove Nebula confirm
```

Tus datos y tu configuración no se borran.

## Alternativa sin NSSM

Programador de tareas → «Crear tarea» → desencadenador «Al iniciar el sistema» → acción: ejecutar `npm start` con «Iniciar en» la carpeta del proyecto. No reinicia Nebula si se cae.
