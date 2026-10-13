import { EnglishOnly } from "@/components/english-only";

// Admin stays English and left-to-right in every language.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <EnglishOnly>{children}</EnglishOnly>;
}
