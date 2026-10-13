import { EnglishOnly } from "@/components/english-only";

// This part of the app is not translated yet: it stays English and left-to-right in every language.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <EnglishOnly>{children}</EnglishOnly>;
}
