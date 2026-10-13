import type { inviteEn } from "@/lib/i18n/en/invite";
import { phoneInvalid } from "@/lib/i18n/pt/common";
import { shared } from "@/lib/i18n/pt/shared";

// "Contatos" here are the phone's address book; the people someone is connected with on YuKon3t are "conexões".
export const invite: typeof inviteEn = {
  controls: { phoneField: shared.phoneField, phoneInvalid },
  title: "Convidar amigos",
  intro: "Traga as pessoas que você conhece para o YuKon3t.",
  message: "Venha para o YuKon3t comigo e conecte-se com pessoas de outras culturas, interesses e países:",
  linkHeading: "Seu link de convite",
  copy: "Copiar",
  copied: "Copiado!",
  copyFailed: "Não foi possível copiar",
  share: "Compartilhar",
  textHeading: "Convidar por mensagem de texto",
  textIntro:
    "Escolha contatos (quando disponível) ou digite um número e envie a cada pessoa uma mensagem de texto com seu link de convite.",
  openingContacts: "Abrindo contatos…",
  chooseContacts: "Escolher dos contatos",
  phoneLabel: "Número de telefone",
  add: "Adicionar",
  invite: "Convidar",
  remove: "Remover",
  pickerTitle: "Escolher contatos",
  searchContacts: "Buscar contatos",
  noMatches: "Nenhum contato encontrado.",
  addSelected: "one: Adicionar # selecionado | other: Adicionar # selecionados",
  selectToAdd: "Selecione contatos para adicionar",
  errors: {
    permission:
      "A permissão de acesso aos contatos foi negada. Ative-a para o YuKon3t nas configurações do seu celular para convidar a partir dos seus contatos.",
    noNumbers: "Nenhum dos seus contatos tem um número de telefone salvo.",
    openFailed: "Não foi possível abrir seus contatos. Tente novamente.",
    pickedNoNumbers: "Esses contatos não têm um número de telefone salvo.",
  },
};
