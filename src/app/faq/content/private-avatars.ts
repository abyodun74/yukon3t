import type { Locale } from "@/lib/i18n/locales";

// The extra paragraph of "Can I save someone's profile picture?" (save-someones-profile-picture): how profile pictures
// are stored (always private, see CLAUDE.md "Profile pictures"). Plain text (no FAQ markup), every language.
export const PRIVATE_AVATARS_NOTE: Record<Locale, string> = {
  en: "Profile pictures are also kept private: they load only for people signed in to YuKon3t, and not for anyone you've blocked or who has blocked you. A picture you add is shown to members as a small version; the larger version opens only for you and your connections.",
  es: "Además, las fotos de perfil se guardan de forma privada: solo se cargan para quienes han iniciado sesión en YuKon3t, y no para nadie a quien hayas bloqueado o que te haya bloqueado. Una foto que agregues se muestra a los miembros en una versión pequeña; la versión más grande solo se abre para ti y tus contactos.",
  fr: "Les photos de profil sont en outre conservées de façon privée : elles ne s'affichent que pour les personnes connectées à YuKon3t, et pour personne que vous avez bloqué ou qui vous a bloqué. Une photo que vous ajoutez est montrée aux membres en petite version ; la version plus grande ne s'ouvre que pour vous et vos relations.",
  pt: "Além disso, as fotos de perfil são guardadas de forma privada: só carregam para quem está conectado ao YuKon3t, e não para ninguém que você bloqueou ou que bloqueou você. Uma foto que você adiciona aparece para os membros em uma versão pequena; a versão maior só abre para você e suas conexões.",
  ar: "كما تُحفظ صور الملفات الشخصية بشكل خاص: لا تظهر إلا لمن سجّل الدخول إلى YuKon3t، ولا تظهر لأي شخص حظرته أو حظرك. تظهر الصورة التي تضيفها للأعضاء بنسخة صغيرة، أما النسخة الأكبر فلا تُفتح إلا لك ولجهات اتصالك.",
};
