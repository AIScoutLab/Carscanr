import { LegalDocumentScreen } from "@/components/LegalDocumentScreen";
import { privacyPolicyDocument } from "@/constants/legalContent";

export default function PrivacyPolicyScreen() {
  return <LegalDocumentScreen document={privacyPolicyDocument} />;
}
