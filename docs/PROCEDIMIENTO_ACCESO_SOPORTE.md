# Procedimiento de acceso técnico SOPORTE PACHAX

Este procedimiento prepara una identidad individual ya aprobada por el titular de PACHAX. El repositorio no crea contraseñas ni habilita una cuenta por defecto. No modifica la identidad de Nelson ni otorga administración financiera.

## Aprovisionar

1. El titular de PACHAX identifica al operador y aprueba la identidad por el canal corporativo vigente. El operador autorizado registra la referencia de aprobación y confirma que el proyecto indicado es el de producción correcto.
2. El titular/administrador de identidad crea una cuenta individual de Firebase Authentication con la dirección aprobada. No reutilizar cuentas personales compartidas. La autenticación multifactor debe estar habilitada en Identity Platform.
3. El operador inicia sesión como titular de esa identidad y registra un segundo factor en Firebase Auth. La persona titular completa la inscripción; el script no puede inscribir factores por ella.
4. Con ADC de corta duración y el proyecto explícito, revisar el UID existente en modo de vista previa:

   ```powershell
   node scripts/supportIdentity.mjs --action provision --project <PROJECT_ID> --uid <UID> --approval-reference <TICKET>
   ```

5. Confirmar en la vista previa el proyecto, UID, estado de Auth, número de factores inscritos y rol actual. Para aplicar, repetir con `--apply` y escribir exactamente `PROVISION SUPPORT <UID>` en la consola. No pasar contraseñas, correo, tokens ni secretos por argumentos o archivos.
6. El script solo acepta una identidad Auth existente, habilitada y con factor inscrito. Establece únicamente el custom claim `role=soporte_pachax`, activa un perfil técnico mínimo y escribe auditoría. Si falla la escritura del perfil, restaura los claims previos; si no puede restaurarlos, deshabilita la identidad y revoca sus sesiones.
7. La persona inicia sesión de nuevo para recibir el claim vigente y completa MFA. La aplicación y Functions verifican el perfil activo; en producción, Functions validan el token firmado con revocación, el claim MFA, el estado `disabled` y `auth_time` de cinco minutos para acciones sensibles. Un flag en Firestore no sustituye al claim MFA.
8. Abrir Centro de Soporte y verificar el resumen. Las Rules mantienen el acceso cliente directo a datos técnicos denegado. Las configuraciones financieras no conceden facultades para registrar, cobrar o editar movimientos.

## Revocar y recuperar

Para revocar inmediatamente una identidad, usar la referencia aprobada y el UID confirmado:

```powershell
node scripts/supportIdentity.mjs --action revoke --project <PROJECT_ID> --uid <UID> --approval-reference <TICKET>
```

Revisar primero la vista previa; luego repetir con `--apply` y confirmar `REVOKE SUPPORT <UID>`. La revocación deshabilita Auth, invalida refresh tokens, retira el claim técnico, marca inactivo el perfil y audita la operación. La aplicación falla cerrada ante el token revocado o identidad deshabilitada.

Si el titular pierde su segundo factor, mantener la identidad revocada mientras se verifica su identidad por el proceso de recuperación de PACHAX. Un operador autorizado restablece el segundo factor desde el flujo normal de Identity Platform; el titular vuelve a inscribir MFA. Después, el titular aprueba un ticket nuevo y el operador vuelve a ejecutar el aprovisionamiento para reactivar la identidad. No crear cuentas de emergencia ni compartir códigos de recuperación.

## Verificación y límites

- Las pruebas del emulador simulan claims MFA y verifican las ramas de token viejo, revocado, usuario deshabilitado y factor ausente. No demuestran que exista una cuenta real ni que su factor se haya inscrito.
- Ninguna identidad técnica real se aprovisionó durante el Bloque D. Se requiere aprobación del titular, operador autorizado, proyecto confirmado e inscripción MFA individual.
- No se debe desplegar una activación que asigne este rol a una cuenta de cliente. Los roles de afiliado permanecen separados; las Rules y Functions niegan cambios técnicos del rol desde el cliente.
