import { ErrorMessage } from "@/components/ErrorMessage";

export default function NotFound() {
  return <ErrorMessage code="NOT_FOUND" message="Page not found" />;
}
