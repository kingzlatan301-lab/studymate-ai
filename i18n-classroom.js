/**
 * Interface text for the Classroom Notes screens (fr / es / pt). Merged into SMI18nUI at load; anything published in Supabase
 * (ui_strings, schema 20) overrides it, so a wording fix needs no app release. Applied as plain text only.
 * ALL wording is first-pass and NEEDS NATIVE-SPEAKER REVIEW before launch (same status as i18n.js / i18n-features.js).
 * Keys are the exact English phrases that classroom-notes.js renders ({n}, {a} = numbers).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SMI18nClassroom = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DATA = {
 "fr": {
  "🎓 Classroom Notes": "🎓 Cours en classe",
  "Notes, quick revision, worked examples and practice for each topic.": "Cours, révision rapide, exemples résolus et exercices pour chaque thème.",
  "Your exam goals": "Tes examens visés",
  "＋ Add an exam goal": "＋ Ajouter un examen",
  "No exam goal yet. Add one below. You can add several, from any country.": "Aucun examen choisi. Ajoute-en un ci-dessous. Tu peux en ajouter plusieurs, de n'importe quel pays.",
  "🔖 Bookmarks": "🔖 Favoris",
  "← Classroom Notes": "← Cours en classe",
  "← Study Material": "← Matériel d'étude",
  "Add an exam goal": "Ajouter un examen",
  "Pick any country's exam. Your location never limits you.": "Choisis l'examen de n'importe quel pays. Ta position ne te limite jamais.",
  "Exam": "Examen",
  "Subject": "Matière",
  "No matching topics in your exam goals.": "Aucun thème correspondant dans tes examens.",
  "Topic outline not available yet": "Plan des thèmes pas encore disponible",
  "{n} topics · {a} done": "{n} thèmes · {a} terminés",
  "Free plan: {n} of {a} new pages left this week. Pages you already generated are free to reread.": "Offre gratuite : {n} pages neuves restantes sur {a} cette semaine. Les pages déjà générées se relisent gratuitement.",
  "⬇ Save available pages for offline": "⬇ Enregistrer les pages disponibles hors ligne",
  "({n} on this device)": "({n} sur cet appareil)",
  "Offline: you can read pages saved on this device.": "Hors ligne : tu peux lire les pages enregistrées sur cet appareil.",
  "My notes on this topic": "Mes notes sur ce thème",
  "☑ Mark topic as completed": "☑ Marquer le thème comme terminé",
  "✅ Completed (tap to undo)": "✅ Terminé (touche pour annuler)",
  "{n} of {a} topics completed": "{n} thèmes terminés sur {a}",
  "Notes": "Cours",
  "At a Glance": "En un coup d'œil",
  "Examples": "Exemples",
  "Practice": "Exercices",
  "🔄 Regenerate (uses 1 Classroom Notes page)": "🔄 Régénérer (utilise 1 page de cours)",
  "🎯 Interactive Practice questions": "🎯 Questions d'entraînement interactives",
  "Search in this page…": "Rechercher dans cette page…",
  "Search topics in your exams…": "Rechercher des thèmes dans tes examens…",
  "No subjects for this exam yet": "Pas encore de matières pour cet examen",
  "Downloading…": "Téléchargement…",
  "Writing…": "Rédaction…",
  "Smaller text": "Texte plus petit",
  "Larger text": "Texte plus grand",
  "Bookmark topic": "Mettre le thème en favori",
  "Search topics": "Rechercher des thèmes",
  "Search within this page": "Rechercher dans cette page",
  "Study any topic": "Étudier n'importe quel thème",
  "AI-generated from a topic you typed. Private to you. Not an official syllabus, not past-paper content.": "Généré par l'IA à partir d'un thème que tu as écrit. Privé, rien que pour toi. Pas un programme officiel, pas du contenu d'annales."
 },
 "es": {
  "🎓 Classroom Notes": "🎓 Apuntes de clase",
  "Notes, quick revision, worked examples and practice for each topic.": "Apuntes, repaso rápido, ejemplos resueltos y práctica para cada tema.",
  "Your exam goals": "Tus exámenes objetivo",
  "＋ Add an exam goal": "＋ Añadir un examen",
  "No exam goal yet. Add one below. You can add several, from any country.": "Aún no hay examen elegido. Añade uno abajo. Puedes añadir varios, de cualquier país.",
  "🔖 Bookmarks": "🔖 Favoritos",
  "← Classroom Notes": "← Apuntes de clase",
  "← Study Material": "← Material de estudio",
  "Add an exam goal": "Añadir un examen",
  "Pick any country's exam. Your location never limits you.": "Elige el examen de cualquier país. Tu ubicación nunca te limita.",
  "Exam": "Examen",
  "Subject": "Asignatura",
  "No matching topics in your exam goals.": "No hay temas que coincidan en tus exámenes.",
  "Topic outline not available yet": "Esquema de temas aún no disponible",
  "{n} topics · {a} done": "{n} temas · {a} completados",
  "Free plan: {n} of {a} new pages left this week. Pages you already generated are free to reread.": "Plan gratuito: te quedan {n} de {a} páginas nuevas esta semana. Las páginas ya generadas se releen gratis.",
  "⬇ Save available pages for offline": "⬇ Guardar las páginas disponibles sin conexión",
  "({n} on this device)": "({n} en este dispositivo)",
  "Offline: you can read pages saved on this device.": "Sin conexión: puedes leer las páginas guardadas en este dispositivo.",
  "My notes on this topic": "Mis notas sobre este tema",
  "☑ Mark topic as completed": "☑ Marcar el tema como completado",
  "✅ Completed (tap to undo)": "✅ Completado (toca para deshacer)",
  "{n} of {a} topics completed": "{n} de {a} temas completados",
  "Notes": "Apuntes",
  "At a Glance": "De un vistazo",
  "Examples": "Ejemplos",
  "Practice": "Práctica",
  "🔄 Regenerate (uses 1 Classroom Notes page)": "🔄 Regenerar (usa 1 página de apuntes)",
  "🎯 Interactive Practice questions": "🎯 Preguntas de práctica interactivas",
  "Search in this page…": "Buscar en esta página…",
  "Search topics in your exams…": "Buscar temas en tus exámenes…",
  "No subjects for this exam yet": "Aún no hay asignaturas para este examen",
  "Downloading…": "Descargando…",
  "Writing…": "Escribiendo…",
  "Smaller text": "Texto más pequeño",
  "Larger text": "Texto más grande",
  "Bookmark topic": "Marcar el tema como favorito",
  "Search topics": "Buscar temas",
  "Search within this page": "Buscar en esta página",
  "Study any topic": "Estudiar cualquier tema",
  "AI-generated from a topic you typed. Private to you. Not an official syllabus, not past-paper content.": "Generado por la IA a partir de un tema que escribiste. Privado, solo para ti. No es un programa oficial ni contenido de exámenes anteriores."
 },
 "pt": {
  "🎓 Classroom Notes": "🎓 Notas de aula",
  "Notes, quick revision, worked examples and practice for each topic.": "Notas, revisão rápida, exemplos resolvidos e prática para cada tema.",
  "Your exam goals": "Os teus exames-alvo",
  "＋ Add an exam goal": "＋ Adicionar um exame",
  "No exam goal yet. Add one below. You can add several, from any country.": "Ainda não escolheste um exame. Adiciona um abaixo. Podes adicionar vários, de qualquer país.",
  "🔖 Bookmarks": "🔖 Favoritos",
  "← Classroom Notes": "← Notas de aula",
  "← Study Material": "← Material de estudo",
  "Add an exam goal": "Adicionar um exame",
  "Pick any country's exam. Your location never limits you.": "Escolhe o exame de qualquer país. A tua localização nunca te limita.",
  "Exam": "Exame",
  "Subject": "Disciplina",
  "No matching topics in your exam goals.": "Nenhum tema correspondente nos teus exames.",
  "Topic outline not available yet": "Esquema de temas ainda não disponível",
  "{n} topics · {a} done": "{n} temas · {a} concluídos",
  "Free plan: {n} of {a} new pages left this week. Pages you already generated are free to reread.": "Plano gratuito: restam {n} de {a} páginas novas esta semana. As páginas já geradas relêem-se de graça.",
  "⬇ Save available pages for offline": "⬇ Guardar as páginas disponíveis offline",
  "({n} on this device)": "({n} neste dispositivo)",
  "Offline: you can read pages saved on this device.": "Offline: podes ler as páginas guardadas neste dispositivo.",
  "My notes on this topic": "As minhas notas sobre este tema",
  "☑ Mark topic as completed": "☑ Marcar o tema como concluído",
  "✅ Completed (tap to undo)": "✅ Concluído (toca para desfazer)",
  "{n} of {a} topics completed": "{n} de {a} temas concluídos",
  "Notes": "Notas",
  "At a Glance": "Num relance",
  "Examples": "Exemplos",
  "Practice": "Prática",
  "🔄 Regenerate (uses 1 Classroom Notes page)": "🔄 Regenerar (usa 1 página de notas)",
  "🎯 Interactive Practice questions": "🎯 Perguntas de prática interativas",
  "Search in this page…": "Pesquisar nesta página…",
  "Search topics in your exams…": "Pesquisar temas nos teus exames…",
  "No subjects for this exam yet": "Ainda não há disciplinas para este exame",
  "Downloading…": "A transferir…",
  "Writing…": "A escrever…",
  "Smaller text": "Texto mais pequeno",
  "Larger text": "Texto maior",
  "Bookmark topic": "Marcar o tema como favorito",
  "Search topics": "Pesquisar temas",
  "Search within this page": "Pesquisar nesta página",
  "Study any topic": "Estudar qualquer tema",
  "AI-generated from a topic you typed. Private to you. Not an official syllabus, not past-paper content.": "Gerado pela IA a partir de um tema que escreveste. Privado, só para ti. Não é um programa oficial nem conteúdo de exames anteriores."
 }
};
  var REVIEW_STATUS = { fr: 'needs-native-review', es: 'needs-native-review', pt: 'needs-native-review' };
  var api = { data: DATA, reviewStatus: REVIEW_STATUS, scope: '#studymaterial-content .cn-root' };
  // i18n-features.js may load after this file, so install now if possible and again once the page has loaded.
  var installed = false;
  function install() {
    if (installed || typeof window === 'undefined' || !window.SMI18nUI || !window.SMI18nUI.extend) return;
    installed = true; window.SMI18nUI.addScope(api.scope);
    Object.keys(DATA).forEach(function (l) { window.SMI18nUI.extend(l, DATA[l]); });
  }
  if (typeof window !== 'undefined') { install(); window.addEventListener('DOMContentLoaded', install); window.addEventListener('load', install); }
  return api;
});
