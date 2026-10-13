import { FeedLayout } from "@/components/feed-layout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <FeedLayout>{children}</FeedLayout>;
}
