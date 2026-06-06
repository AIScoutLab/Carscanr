import { LegalDocumentScreen } from "@/components/LegalDocumentScreen";
import { termsOfServiceDocument } from "@/constants/legalContent";

export default function TermsOfServiceScreen() {
  return <LegalDocumentScreen document={termsOfServiceDocument} />;
}
