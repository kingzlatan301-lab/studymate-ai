/**
 * StudyMate AI — minimal UI internationalisation (opt-in, safe by default)
 * ─────────────────────────────────────────────────────────────────────────
 * PRODUCT DECISION (documented in README "Languages"): the Settings → Language
 * choice drives BOTH the language of AI answers (unchanged) AND the app's
 * interface text, for languages that have a dictionary below. Any language
 * without a dictionary — or any key missing from one — shows English. That
 * means a half-translated UI can never show a blank label.
 *
 * HOW TO TRANSLATE A SCREEN
 *   1. Add the key to `en` (source of truth) and to each locale.
 *   2. Mark the element:   <span data-i18n="nav.home">Home</span>
 *      attributes:         <button data-i18n-attr="aria-label:nav.search">
 *   3. In JS strings use   SMI18n.t('toast.language', { language: 'Français' }).
 * Text is written with textContent / setAttribute only — a translation can
 * never inject markup. tests/i18n.test.js enforces key parity and that.
 *
 * STATUS: nav, onboarding, paywall, sign-in gate, key buttons, common error toasts, scope note.
 * Still English-only: Ask/Practice/Mock/Flashcards/Teach Me screens, Progress, most Settings, server error text.
 * fr/es/pt strings are first-pass and ALL NEED NATIVE-SPEAKER REVIEW before launch (see REVIEW_STATUS).
 * ar/ur/fa need `dir="rtl"` layout work (handled by RTL_LOCALES below, but the
 * CSS has not been audited for RTL), so no RTL dictionary ships yet.
 */
(function (root) {
  var en = {
    "nav.home": "Home",
    "nav.ask": "Ask AI",
    "nav.practice": "Practice",
    "nav.saved": "Saved",
    "nav.progress": "Progress",
    "nav.profile": "Profile",
    "toast.language": "Answers will now explain in {language}",
    "common.done": "Done",
    "common.skip": "Skip for now",
    "common.later": "Maybe later",
    "scope.note": "StudyMate currently covers selected exams in {count} countries, plus IGCSE and IB worldwide.",
    "onb.name.title": "Hey, I'm Bagley 🤖",
    "onb.name.sub": "Your unreasonably capable study assistant. I solve problems, keep receipts, and occasionally judge your handwriting. What should I call you?",
    "onb.name.placeholder": "Enter your first name",
    "onb.name.cta": "Nice to meet you 🚀",
    "onb.name.required": "Go on, tell me your name.",
    "onb.country.title": "Where are you studying, {name}? 🌍",
    "onb.friend": "friend",
    "onb.country.sub": "This decides which exam boards and subjects I'll show you.",
    "onb.exam.title": "Right, {name} 📋",
    "onb.mate": "mate",
    "onb.exam.sub": "Which exam are we conquering?",
    "onb.class.title": "Noted 🎒",
    "onb.class.sub": "What class/year are you in right now?",
    "onb.routine.title": "Last thing 📖",
    "onb.routine.sub": "Be honest — how do you usually read?",
    "onb.plan.title": "Sorted. 🧠",
    "onb.plan.cta": "Let's get to work 🚀",
    "pay.aria": "Upgrade to Premium",
    "pay.title": "StudyMate Premium",
    "pay.sub": "Study without daily limits.",
    "pay.tag": "Monthly plan",
    "pay.f.limits": "No daily or weekly limits on Ask AI, Practice, Mock Exams, Flashcards, Teach Me and summaries",
    "pay.f.paper": "Past-paper analysis, up to 5 a week",
    "pay.f.progress": "Progress trends and daily missions",
    "pay.f.looks": "Every background, accent and Bagley look",
    "pay.f.cbt": "JAMB CBT simulation (Nigeria)",
    "pay.subscribe": "Subscribe",
    "pay.perMonth": "/ month",
    "pay.loading": "Loading your price…",
    "pay.error": "We couldn’t load your price. Check your connection and try again.",
    "pay.retry": "Retry",
    "pay.billedIn": "Charged in {currency} through Paystack.",
    "pay.billing": "Billing details",
    "pay.priceUnavailable": "Price unavailable",
    "auth.title": "Welcome to StudyMate AI 🎓",
    "auth.sub": "Sign in or create a free account to get started — this keeps your progress safe and is how Premium gets activated correctly.",
    "auth.email": "Email",
    "auth.password": "Password (min 6 characters)",
    "auth.signin": "Sign In",
    "auth.signup": "Create Account",
    "auth.or": "OR",
    "auth.google": "Continue with Google",
    "err.signinFirst": "Sign in first — Premium needs an account so it can renew correctly",
    "err.paymentLoad": "Payment service failed to load — check your connection and try again",
    "err.priceLoading": "Loading your price — try again in a moment",
    "err.paymentConfig": "Payments are temporarily unavailable (configuration problem). You have not been charged — please contact support.",
    "err.checkoutNetwork": "Could not reach the server to start checkout — check your connection and try again.",
    "err.photoRead": "Could not read that photo — try again",
    "err.fileTooLarge": "File is too large (2MB limit)",
    "err.subjectsUnavailable": "Subjects for this exam board are not available yet.",
    "err.signinToSave": "Sign in to save questions",
    "err.signinToFeedback": "Sign in to send feedback",
    "toast.signedIn": "Signed in",
    "toast.signedOut": "Signed out",
    "settings.country.title": "Country & Exam Mode 📋",
    "settings.country.sub": "Align answers with your country's exam board and marking style",
    "acct.export": "Export my data",
    "acct.delete": "Delete my account",
    "acct.exporting": "Preparing your data…",
    "acct.exportReady": "Your data export has been downloaded",
    "acct.deleteTitle": "Delete your account?",
    "acct.deleteWarn": "This permanently deletes your StudyMate account, your progress and saved questions, and your payment records. Any remaining Premium time is lost. This cannot be undone.",
    "acct.deletePrompt": "Type DELETE to confirm",
    "acct.deleteCta": "Permanently delete my account",
    "acct.deleted": "Your account has been deleted",
    "acct.err.generic": "Something went wrong — please try again.",
    "common.cancel": "Cancel"
  };
  var dictionaries = {
    en: en,
    fr: {
      "nav.home": "Accueil",
      "nav.ask": "Demander à l’IA",
      "nav.practice": "S’entraîner",
      "nav.saved": "Enregistrés",
      "nav.progress": "Progrès",
      "nav.profile": "Profil",
      "toast.language": "Les réponses seront désormais expliquées en {language}",
      "common.done": "Terminé",
      "common.skip": "Passer pour l’instant",
      "common.later": "Plus tard",
      "scope.note": "StudyMate couvre actuellement une sélection d’examens dans {count} pays, plus l’IGCSE et l’IB dans le monde entier.",
      "onb.name.title": "Salut, je suis Bagley 🤖",
      "onb.name.sub": "Ton assistant d’étude d’une efficacité déraisonnable. Je résous les problèmes, je garde les preuves et je juge parfois ton écriture. Comment dois-je t’appeler ?",
      "onb.name.placeholder": "Entre ton prénom",
      "onb.name.cta": "Ravi de te rencontrer 🚀",
      "onb.name.required": "Allez, dis-moi ton prénom.",
      "onb.country.title": "Où étudies-tu, {name} ? 🌍",
      "onb.friend": "l’ami",
      "onb.country.sub": "Cela détermine les examens et les matières que je te montrerai.",
      "onb.exam.title": "Très bien, {name} 📋",
      "onb.mate": "camarade",
      "onb.exam.sub": "Quel examen allons-nous conquérir ?",
      "onb.class.title": "Noté 🎒",
      "onb.class.sub": "Dans quelle classe ou année es-tu en ce moment ?",
      "onb.routine.title": "Dernière chose 📖",
      "onb.routine.sub": "Sois honnête — comment lis-tu d’habitude ?",
      "onb.plan.title": "C’est réglé. 🧠",
      "onb.plan.cta": "Au travail 🚀",
      "pay.aria": "Passer à Premium",
      "pay.title": "StudyMate Premium",
      "pay.sub": "Étudie sans limites quotidiennes.",
      "pay.tag": "Abonnement mensuel",
      "pay.f.limits": "Aucune limite quotidienne ou hebdomadaire sur Ask AI, l’entraînement, les examens blancs, les cartes mémoire, « Explique-moi » et les résumés",
      "pay.f.paper": "Analyse d’annales, jusqu’à 5 par semaine",
      "pay.f.progress": "Tendances de progression et missions quotidiennes",
      "pay.f.looks": "Tous les fonds, accents et looks de Bagley",
      "pay.f.cbt": "Simulation CBT du JAMB (Nigeria)",
      "pay.subscribe": "S’abonner",
      "pay.perMonth": "/ mois",
      "pay.loading": "Chargement du prix…",
      "pay.error": "Impossible de charger ton prix. Vérifie ta connexion et réessaie.",
      "pay.retry": "Réessayer",
      "pay.billedIn": "Facturé en {currency} via Paystack.",
      "pay.billing": "Détails de facturation",
      "pay.priceUnavailable": "Prix indisponible",
      "auth.title": "Bienvenue sur StudyMate AI 🎓",
      "auth.sub": "Connecte-toi ou crée un compte gratuit pour commencer — cela protège ta progression et permet d’activer Premium correctement.",
      "auth.email": "E-mail",
      "auth.password": "Mot de passe (6 caractères minimum)",
      "auth.signin": "Se connecter",
      "auth.signup": "Créer un compte",
      "auth.or": "OU",
      "auth.google": "Continuer avec Google",
      "err.signinFirst": "Connecte-toi d’abord — Premium nécessite un compte pour se renouveler correctement",
      "err.paymentLoad": "Le service de paiement n’a pas pu se charger — vérifie ta connexion et réessaie",
      "err.priceLoading": "Chargement du prix — réessaie dans un instant",
      "err.paymentConfig": "Les paiements sont temporairement indisponibles (problème de configuration). Tu n’as pas été débité — contacte le support.",
      "err.checkoutNetwork": "Impossible de joindre le serveur pour lancer le paiement — vérifie ta connexion et réessaie.",
      "err.photoRead": "Impossible de lire cette photo — réessaie",
      "err.fileTooLarge": "Fichier trop volumineux (limite de 2 Mo)",
      "err.subjectsUnavailable": "Les matières de cet examen ne sont pas encore disponibles.",
      "err.signinToSave": "Connecte-toi pour enregistrer des questions",
      "err.signinToFeedback": "Connecte-toi pour envoyer un avis",
      "toast.signedIn": "Connecté",
      "toast.signedOut": "Déconnecté",
      "settings.country.title": "Pays et mode examen 📋",
      "settings.country.sub": "Adapte les réponses à l’examen et au barème de ton pays",
      "acct.export": "Exporter mes données",
      "acct.delete": "Supprimer mon compte",
      "acct.exporting": "Préparation de tes données…",
      "acct.exportReady": "Ton export de données a été téléchargé",
      "acct.deleteTitle": "Supprimer ton compte ?",
      "acct.deleteWarn": "Cela supprime définitivement ton compte StudyMate, ta progression, tes questions enregistrées et tes justificatifs de paiement. Le temps Premium restant sera perdu. Cette action est irréversible.",
      "acct.deletePrompt": "Tape DELETE pour confirmer",
      "acct.deleteCta": "Supprimer définitivement mon compte",
      "acct.deleted": "Ton compte a été supprimé",
      "acct.err.generic": "Une erreur s’est produite — réessaie.",
      "common.cancel": "Annuler"
    },
    es: {
      "nav.home": "Inicio",
      "nav.ask": "Preguntar a la IA",
      "nav.practice": "Practicar",
      "nav.saved": "Guardado",
      "nav.progress": "Progreso",
      "nav.profile": "Perfil",
      "toast.language": "Ahora las respuestas se explicarán en {language}",
      "common.done": "Listo",
      "common.skip": "Omitir por ahora",
      "common.later": "Quizás más tarde",
      "scope.note": "StudyMate cubre actualmente exámenes seleccionados en {count} países, además de IGCSE e IB en todo el mundo.",
      "onb.name.title": "Hola, soy Bagley 🤖",
      "onb.name.sub": "Tu asistente de estudio irrazonablemente capaz. Resuelvo problemas, guardo las pruebas y a veces juzgo tu letra. ¿Cómo debo llamarte?",
      "onb.name.placeholder": "Escribe tu nombre",
      "onb.name.cta": "Encantado de conocerte 🚀",
      "onb.name.required": "Vamos, dime tu nombre.",
      "onb.country.title": "¿Dónde estudias, {name}? 🌍",
      "onb.friend": "amigo",
      "onb.country.sub": "Esto decide qué exámenes y asignaturas te mostraré.",
      "onb.exam.title": "Bien, {name} 📋",
      "onb.mate": "colega",
      "onb.exam.sub": "¿Qué examen vamos a conquistar?",
      "onb.class.title": "Anotado 🎒",
      "onb.class.sub": "¿En qué curso o año estás ahora?",
      "onb.routine.title": "Lo último 📖",
      "onb.routine.sub": "Sé sincero: ¿cómo sueles estudiar leyendo?",
      "onb.plan.title": "Listo. 🧠",
      "onb.plan.cta": "Manos a la obra 🚀",
      "pay.aria": "Pasar a Premium",
      "pay.title": "StudyMate Premium",
      "pay.sub": "Estudia sin límites diarios.",
      "pay.tag": "Plan mensual",
      "pay.f.limits": "Sin límites diarios ni semanales en Ask AI, práctica, exámenes de práctica, tarjetas, «Enséñame» y resúmenes",
      "pay.f.paper": "Análisis de exámenes anteriores, hasta 5 por semana",
      "pay.f.progress": "Tendencias de progreso y misiones diarias",
      "pay.f.looks": "Todos los fondos, acentos y looks de Bagley",
      "pay.f.cbt": "Simulación CBT del JAMB (Nigeria)",
      "pay.subscribe": "Suscribirme",
      "pay.perMonth": "/ mes",
      "pay.loading": "Cargando tu precio…",
      "pay.error": "No pudimos cargar tu precio. Revisa tu conexión e inténtalo de nuevo.",
      "pay.retry": "Reintentar",
      "pay.billedIn": "Se cobra en {currency} a través de Paystack.",
      "pay.billing": "Detalles de facturación",
      "pay.priceUnavailable": "Precio no disponible",
      "auth.title": "Te damos la bienvenida a StudyMate AI 🎓",
      "auth.sub": "Inicia sesión o crea una cuenta gratuita para empezar: así tu progreso está a salvo y Premium se activa correctamente.",
      "auth.email": "Correo electrónico",
      "auth.password": "Contraseña (mínimo 6 caracteres)",
      "auth.signin": "Iniciar sesión",
      "auth.signup": "Crear cuenta",
      "auth.or": "O",
      "auth.google": "Continuar con Google",
      "err.signinFirst": "Inicia sesión primero: Premium necesita una cuenta para renovarse correctamente",
      "err.paymentLoad": "No se pudo cargar el servicio de pago: revisa tu conexión e inténtalo de nuevo",
      "err.priceLoading": "Cargando tu precio: inténtalo de nuevo en un momento",
      "err.paymentConfig": "Los pagos no están disponibles temporalmente (problema de configuración). No se te ha cobrado: contacta con soporte.",
      "err.checkoutNetwork": "No se pudo conectar con el servidor para iniciar el pago: revisa tu conexión e inténtalo de nuevo.",
      "err.photoRead": "No se pudo leer esa foto: inténtalo de nuevo",
      "err.fileTooLarge": "El archivo es demasiado grande (límite de 2 MB)",
      "err.subjectsUnavailable": "Las asignaturas de este examen aún no están disponibles.",
      "err.signinToSave": "Inicia sesión para guardar preguntas",
      "err.signinToFeedback": "Inicia sesión para enviar comentarios",
      "toast.signedIn": "Sesión iniciada",
      "toast.signedOut": "Sesión cerrada",
      "settings.country.title": "País y modo examen 📋",
      "settings.country.sub": "Adapta las respuestas al examen y a los criterios de corrección de tu país",
      "acct.export": "Exportar mis datos",
      "acct.delete": "Eliminar mi cuenta",
      "acct.exporting": "Preparando tus datos…",
      "acct.exportReady": "Tu exportación de datos se ha descargado",
      "acct.deleteTitle": "¿Eliminar tu cuenta?",
      "acct.deleteWarn": "Esto elimina de forma permanente tu cuenta de StudyMate, tu progreso, tus preguntas guardadas y tus registros de pago. El tiempo Premium restante se perderá. No se puede deshacer.",
      "acct.deletePrompt": "Escribe DELETE para confirmar",
      "acct.deleteCta": "Eliminar mi cuenta definitivamente",
      "acct.deleted": "Tu cuenta ha sido eliminada",
      "acct.err.generic": "Algo salió mal: inténtalo de nuevo.",
      "common.cancel": "Cancelar"
    },
    pt: {
      "nav.home": "Início",
      "nav.ask": "Perguntar à IA",
      "nav.practice": "Praticar",
      "nav.saved": "Guardados",
      "nav.progress": "Progresso",
      "nav.profile": "Perfil",
      "toast.language": "As respostas agora serão explicadas em {language}",
      "common.done": "Concluído",
      "common.skip": "Saltar por agora",
      "common.later": "Talvez mais tarde",
      "scope.note": "O StudyMate cobre atualmente exames selecionados em {count} países, além de IGCSE e IB em todo o mundo.",
      "onb.name.title": "Olá, eu sou o Bagley 🤖",
      "onb.name.sub": "O teu assistente de estudo irracionalmente capaz. Resolvo problemas, guardo provas e às vezes julgo a tua letra. Como devo chamar-te?",
      "onb.name.placeholder": "Escreve o teu primeiro nome",
      "onb.name.cta": "Prazer em conhecer-te 🚀",
      "onb.name.required": "Vá lá, diz-me o teu nome.",
      "onb.country.title": "Onde estudas, {name}? 🌍",
      "onb.friend": "amigo",
      "onb.country.sub": "Isto decide que exames e disciplinas te vou mostrar.",
      "onb.exam.title": "Certo, {name} 📋",
      "onb.mate": "colega",
      "onb.exam.sub": "Que exame vamos conquistar?",
      "onb.class.title": "Anotado 🎒",
      "onb.class.sub": "Em que ano ou classe estás agora?",
      "onb.routine.title": "Última coisa 📖",
      "onb.routine.sub": "Sê sincero: como costumas estudar a ler?",
      "onb.plan.title": "Tudo certo. 🧠",
      "onb.plan.cta": "Mãos à obra 🚀",
      "pay.aria": "Mudar para Premium",
      "pay.title": "StudyMate Premium",
      "pay.sub": "Estuda sem limites diários.",
      "pay.tag": "Plano mensal",
      "pay.f.limits": "Sem limites diários ou semanais em Ask AI, prática, exames simulados, cartões, «Ensina-me» e resumos",
      "pay.f.paper": "Análise de exames anteriores, até 5 por semana",
      "pay.f.progress": "Tendências de progresso e missões diárias",
      "pay.f.looks": "Todos os fundos, destaques e looks do Bagley",
      "pay.f.cbt": "Simulação CBT do JAMB (Nigéria)",
      "pay.subscribe": "Subscrever",
      "pay.perMonth": "/ mês",
      "pay.loading": "A carregar o teu preço…",
      "pay.error": "Não foi possível carregar o teu preço. Verifica a ligação e tenta novamente.",
      "pay.retry": "Tentar novamente",
      "pay.billedIn": "Cobrado em {currency} através do Paystack.",
      "pay.billing": "Detalhes de faturação",
      "pay.priceUnavailable": "Preço indisponível",
      "auth.title": "Bem-vindo ao StudyMate AI 🎓",
      "auth.sub": "Inicia sessão ou cria uma conta gratuita para começar: assim o teu progresso fica seguro e o Premium é ativado corretamente.",
      "auth.email": "E-mail",
      "auth.password": "Palavra-passe (mínimo 6 caracteres)",
      "auth.signin": "Iniciar sessão",
      "auth.signup": "Criar conta",
      "auth.or": "OU",
      "auth.google": "Continuar com o Google",
      "err.signinFirst": "Inicia sessão primeiro: o Premium precisa de uma conta para renovar corretamente",
      "err.paymentLoad": "Não foi possível carregar o serviço de pagamento: verifica a ligação e tenta novamente",
      "err.priceLoading": "A carregar o teu preço: tenta novamente daqui a pouco",
      "err.paymentConfig": "Os pagamentos estão temporariamente indisponíveis (problema de configuração). Não foste cobrado: contacta o suporte.",
      "err.checkoutNetwork": "Não foi possível contactar o servidor para iniciar o pagamento: verifica a ligação e tenta novamente.",
      "err.photoRead": "Não foi possível ler essa foto: tenta novamente",
      "err.fileTooLarge": "O ficheiro é demasiado grande (limite de 2 MB)",
      "err.subjectsUnavailable": "As disciplinas deste exame ainda não estão disponíveis.",
      "err.signinToSave": "Inicia sessão para guardar perguntas",
      "err.signinToFeedback": "Inicia sessão para enviar comentários",
      "toast.signedIn": "Sessão iniciada",
      "toast.signedOut": "Sessão terminada",
      "settings.country.title": "País e modo de exame 📋",
      "settings.country.sub": "Ajusta as respostas ao exame e aos critérios de correção do teu país",
      "acct.export": "Exportar os meus dados",
      "acct.delete": "Eliminar a minha conta",
      "acct.exporting": "A preparar os teus dados…",
      "acct.exportReady": "A tua exportação de dados foi transferida",
      "acct.deleteTitle": "Eliminar a tua conta?",
      "acct.deleteWarn": "Isto elimina permanentemente a tua conta StudyMate, o teu progresso, as perguntas guardadas e os registos de pagamento. O tempo Premium restante perde-se. Não é possível desfazer.",
      "acct.deletePrompt": "Escreve DELETE para confirmar",
      "acct.deleteCta": "Eliminar a minha conta definitivamente",
      "acct.deleted": "A tua conta foi eliminada",
      "acct.err.generic": "Algo correu mal: tenta novamente.",
      "common.cancel": "Cancelar"
    }
  };
  // Review state per locale. 'needs-native-review' = first-pass wording, not yet checked by a native speaker.
  var REVIEW_STATUS = { en: 'source', fr: 'needs-native-review', es: 'needs-native-review', pt: 'needs-native-review' };
  var RTL_LOCALES = { ar: 1, ur: 1, fa: 1, he: 1 };
  var locale = 'en';

  function resolve(code) { return dictionaries[code] ? code : 'en'; }

  function t(key, vars) {
    var d = dictionaries[locale] || en;
    var s = Object.prototype.hasOwnProperty.call(d, key) ? d[key]
          : Object.prototype.hasOwnProperty.call(en, key) ? en[key] : key;
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m; });
    return s;
  }

  function apply(scope) {
    var doc = root.document; if (!doc) return;
    var rootEl = scope || doc;
    rootEl.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    rootEl.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var i = pair.indexOf(':'); if (i < 1) return;
        el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
      });
    });
  }

  function setLocale(code) {
    locale = resolve(code);
    var doc = root.document;
    if (doc && doc.documentElement) {
      // The interface language only changes when a dictionary exists for it.
      doc.documentElement.setAttribute('lang', locale);
      doc.documentElement.setAttribute('dir', RTL_LOCALES[locale] ? 'rtl' : 'ltr');
    }
    apply();
    return locale;
  }

  var api = { t: t, apply: apply, setLocale: setLocale, locales: function () { return Object.keys(dictionaries); }, _dictionaries: dictionaries, _rtl: RTL_LOCALES, reviewStatus: REVIEW_STATUS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SMI18n = api;
})(typeof window !== 'undefined' ? window : globalThis);
