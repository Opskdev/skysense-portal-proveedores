(function(){
  const IDIOMAS=["es","en"];
  const CLAVE="sky_idioma";

  const DIC={
    es:{
      "idioma.etiqueta":"Idioma",
      "login.subtitulo":"Portal de Proveedores",
      "login.correo":"Correo electrónico",
      "login.correo_ph":"correo@empresa.com",
      "login.contrasena":"Contraseña",
      "login.olvido":"¿Olvidaste tu contraseña?",
      "login.ingresar":"Ingresar",
      "login.procesando":"Procesando…",
      "login.nota":"Tu acceso y permisos están configurados por el administrador del portal.<br/>Si tienes problemas, comunícate con el equipo de IT.",
      "login.reset_titulo":"Restablecer contraseña",
      "login.nueva":"Nueva contraseña",
      "login.nueva_ph":"Mínimo 8 caracteres",
      "login.confirmar":"Confirmar contraseña",
      "login.confirmar_ph":"Repite la contraseña",
      "login.guardar":"Guardar nueva contraseña",
      "saludo.manana":"Buenos días",
      "saludo.tarde":"Buenas tardes",
      "saludo.noche":"Buenas noches",
      "login.redirigiendo":"{saludo}, {nombre}. Redirigiendo…",
      "login.err_vacios":"Ingresa tu correo y contraseña.",
      "login.err_perfil":"No se encontró tu perfil. Contacta al equipo de IT.",
      "login.err_inactiva":"Tu cuenta está desactivada. Contacta al equipo de IT.",
      "login.err_credenciales":"Correo o contraseña incorrectos.",
      "login.err_confirmar":"Confirma tu correo antes de ingresar.",
      "login.err_intentos":"Demasiados intentos. Espera unos minutos.",
      "login.err_generico":"No fue posible ingresar. Intenta de nuevo.",
      "login.err_correo_primero":"Ingresa tu correo primero.",
      "login.err_espera_seg":"Por seguridad solo se puede solicitar un correo cada cierto tiempo. Espera {seg} segundos e intenta de nuevo.",
      "login.err_espera":"Ya se solicitó un correo hace poco. Espera un minuto e intenta de nuevo.",
      "login.err_smtp":"El servidor de correo rechazó el envío. Avisa al equipo de IT.",
      "login.err_correo_invalido":"No fue posible procesar la solicitud con ese correo. Verifica que esté bien escrito.",
      "login.err_envio":"No fue posible enviar el correo. Intenta de nuevo más tarde.",
      "login.ok_envio":"Te enviamos un correo para restablecer tu contraseña. Revisa tu bandeja de entrada y la carpeta de spam.",
      "login.espera_n":"Espera {n} s…",
      "login.err_enlace":"El enlace expiró o ya fue utilizado. Solicita uno nuevo con \"¿Olvidaste tu contraseña?\".",
      "login.err_min8":"La contraseña debe tener al menos 8 caracteres.",
      "login.err_no_coinciden":"Las contraseñas no coinciden.",
      "login.ok_reset":"Contraseña actualizada. Redirigiendo al portal…",
      "login.err_reset":"No fue posible actualizar la contraseña."
    },
    en:{
      "idioma.etiqueta":"Language",
      "login.subtitulo":"Supplier Portal",
      "login.correo":"Email",
      "login.correo_ph":"name@company.com",
      "login.contrasena":"Password",
      "login.olvido":"Forgot your password?",
      "login.ingresar":"Sign in",
      "login.procesando":"Processing…",
      "login.nota":"Your access and permissions are set up by the portal administrator.<br/>If you need help, please contact the SkySense IT team.",
      "login.reset_titulo":"Reset password",
      "login.nueva":"New password",
      "login.nueva_ph":"At least 8 characters",
      "login.confirmar":"Confirm password",
      "login.confirmar_ph":"Re-enter the password",
      "login.guardar":"Save new password",
      "saludo.manana":"Good morning",
      "saludo.tarde":"Good afternoon",
      "saludo.noche":"Good evening",
      "login.redirigiendo":"{saludo}, {nombre}. Redirecting…",
      "login.err_vacios":"Enter your email and password.",
      "login.err_perfil":"Your profile was not found. Please contact the SkySense IT team.",
      "login.err_inactiva":"Your account is inactive. Please contact the SkySense IT team.",
      "login.err_credenciales":"Incorrect email or password.",
      "login.err_confirmar":"Please confirm your email before signing in.",
      "login.err_intentos":"Too many attempts. Please wait a few minutes.",
      "login.err_generico":"Unable to sign in. Please try again.",
      "login.err_correo_primero":"Enter your email first.",
      "login.err_espera_seg":"For security reasons, a new email can only be requested after a short wait. Please try again in {seg} seconds.",
      "login.err_espera":"An email was requested recently. Please wait one minute and try again.",
      "login.err_smtp":"The mail server rejected the message. Please notify the SkySense IT team.",
      "login.err_correo_invalido":"We could not process the request with that email. Please check that it is spelled correctly.",
      "login.err_envio":"The email could not be sent. Please try again later.",
      "login.ok_envio":"We sent you an email to reset your password. Please check your inbox and spam folder.",
      "login.espera_n":"Wait {n} s…",
      "login.err_enlace":"This link has expired or has already been used. Request a new one with \"Forgot your password?\".",
      "login.err_min8":"The password must be at least 8 characters long.",
      "login.err_no_coinciden":"The passwords do not match.",
      "login.ok_reset":"Password updated. Redirecting to the portal…",
      "login.err_reset":"Unable to update the password."
    }
  };

  function detectar(){
    try{ const g=localStorage.getItem(CLAVE); if(IDIOMAS.includes(g)) return g; }catch(e){}
    return String(navigator.language||"es").slice(0,2).toLowerCase()==="en"?"en":"es";
  }
  let actual=detectar();

  function t(clave,vars){
    let s=(DIC[actual]&&DIC[actual][clave]!=null)?DIC[actual][clave]:(DIC.es[clave]!=null?DIC.es[clave]:clave);
    if(vars) s=s.replace(/\{(\w+)\}/g,(m,k)=>vars[k]!=null?vars[k]:m);
    return s;
  }

  function aplicar(raiz){
    const r=raiz||document;
    r.querySelectorAll("[data-i18n]").forEach(el=>{ el.textContent=t(el.dataset.i18n); });
    r.querySelectorAll("[data-i18n-html]").forEach(el=>{ el.innerHTML=t(el.dataset.i18nHtml); });
    r.querySelectorAll("[data-i18n-ph]").forEach(el=>{ el.placeholder=t(el.dataset.i18nPh); });
    r.querySelectorAll("[data-i18n-title]").forEach(el=>{ el.title=t(el.dataset.i18nTitle); });
    document.documentElement.lang=actual;
    document.querySelectorAll("[data-idioma-btn]").forEach(b=>b.classList.toggle("on",b.dataset.idiomaBtn===actual));
  }

  async function guardarEnPerfil(l){
    try{
      if(!window.sb) return;
      const {data:{session}}=await window.sb.auth.getSession();
      if(session) await window.sb.rpc("guardar_mi_idioma",{p_idioma:l});
    }catch(e){}
  }

  function cambiar(l,opciones){
    if(!IDIOMAS.includes(l)) return;
    actual=l;
    try{ localStorage.setItem(CLAVE,l); }catch(e){}
    aplicar();
    document.dispatchEvent(new CustomEvent("idioma",{detail:l}));
    if(!opciones||opciones.guardar!==false) guardarEnPerfil(l);
  }

  function desdePerfil(p){
    if(p&&IDIOMAS.includes(p.idioma)&&p.idioma!==actual) cambiar(p.idioma,{guardar:false});
  }

  function selector(id){
    const c=document.getElementById(id);
    if(!c) return;
    c.innerHTML='<span class="idioma-lbl" data-i18n="idioma.etiqueta"></span>'+
      '<span class="idioma-seg"><button type="button" data-idioma-btn="es">Español</button><button type="button" data-idioma-btn="en">English</button></span>';
    c.querySelectorAll("[data-idioma-btn]").forEach(b=>b.addEventListener("click",()=>cambiar(b.dataset.idiomaBtn)));
    aplicar(c);
  }

  function fecha(d,op){ return new Date(d).toLocaleDateString(actual==="en"?"en-US":"es-MX",Object.assign({timeZone:"America/Mexico_City"},op||{})); }

  window.I18N={t,aplicar,cambiar,desdePerfil,selector,fecha,get idioma(){return actual;},diccionario:DIC};
  window.t=t;
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",()=>aplicar());
  else aplicar();
})();
