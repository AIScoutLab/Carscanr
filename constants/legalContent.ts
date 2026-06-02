export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  items?: string[];
};

export type LegalDocument = {
  title: string;
  updatedLabel: string;
  summary: string;
  sections: LegalSection[];
};

export const privacyPolicyDocument: LegalDocument = {
  title: "Privacy Policy",
  updatedLabel: "Last updated June 2, 2026",
  summary: "This Privacy Policy explains how CarScanr handles information when you use the mobile app and related services.",
  sections: [
    {
      heading: "Information We Collect",
      paragraphs: [
        "We collect information you provide directly, such as your email address, account profile details, support messages, vehicle photos, scan results, Garage entries, and vehicle details you choose to save.",
        "We may also collect app activity and device information needed to operate the service, including scan usage, authentication status, app diagnostics, purchase entitlement status, and basic request logs.",
      ],
    },
    {
      heading: "How We Use Information",
      items: [
        "Identify vehicles and generate scan results.",
        "Provide market values, live listings, pricing insights, and Garage features.",
        "Authenticate accounts, sync user data, restore purchases, and manage Pro Access.",
        "Respond to support requests, issue reports, and feature requests.",
        "Protect the service, debug problems, prevent abuse, and improve app quality.",
      ],
    },
    {
      heading: "Photos and Vehicle Data",
      paragraphs: [
        "Vehicle photos and related scan inputs may be processed by CarScanr and trusted service providers to identify vehicles and return app results. Avoid submitting images that you do not have permission to use.",
      ],
    },
    {
      heading: "Service Providers",
      paragraphs: [
        "We use service providers for hosting, authentication, storage, vehicle analysis, purchase entitlement management, customer support, and app operations. These providers may process information only as needed to provide their services to CarScanr.",
        "Payment details are handled by app store or payment providers. CarScanr does not store full payment card numbers.",
      ],
    },
    {
      heading: "Sharing",
      paragraphs: [
        "We do not sell personal information. We may share information with service providers, when required by law, to protect rights and safety, or as part of a business transfer involving CarScanr.",
      ],
    },
    {
      heading: "Retention and Choices",
      paragraphs: [
        "We keep information only as long as needed for app functionality, support, legal compliance, security, and legitimate business needs. You can contact support to request help accessing, correcting, or deleting account information.",
      ],
    },
    {
      heading: "Security",
      paragraphs: [
        "We use reasonable safeguards designed to protect information. No internet or mobile service can guarantee absolute security.",
      ],
    },
    {
      heading: "Children",
      paragraphs: ["CarScanr is not intended for children under 13, and we do not knowingly collect personal information from children under 13."],
    },
    {
      heading: "Changes",
      paragraphs: ["We may update this Privacy Policy from time to time. The updated date above shows when the current version took effect."],
    },
    {
      heading: "Contact",
      paragraphs: ["Questions about this Privacy Policy can be sent to support@carscanr.com."],
    },
  ],
};

export const termsOfServiceDocument: LegalDocument = {
  title: "Terms of Service",
  updatedLabel: "Last updated June 2, 2026",
  summary: "These Terms of Service explain the rules for using CarScanr and the app features made available through the service.",
  sections: [
    {
      heading: "Acceptance",
      paragraphs: [
        "By using CarScanr, you agree to these Terms of Service. If you do not agree, do not use the app or related services.",
      ],
    },
    {
      heading: "Accounts",
      paragraphs: [
        "You are responsible for the information you provide, activity under your account, and keeping your sign-in credentials secure. You must provide accurate account information and may not use CarScanr for another person without permission.",
      ],
    },
    {
      heading: "Scan Results and Market Information",
      paragraphs: [
        "CarScanr provides vehicle identification, market values, listings, pricing insights, and related information for convenience. Results may be incomplete, delayed, or inaccurate and should not be treated as a professional appraisal, inspection, valuation, financing decision, insurance decision, or legal advice.",
        "Always verify vehicle condition, title status, pricing, specifications, and listing details independently before making purchase, sale, repair, insurance, or financing decisions.",
      ],
    },
    {
      heading: "Photos and User Content",
      paragraphs: [
        "You keep ownership of photos and content you submit. You grant CarScanr permission to process, store, display, and use that content as needed to provide and improve the app. You must have the rights and permissions needed to submit any content.",
      ],
    },
    {
      heading: "Pro Access and Purchases",
      paragraphs: [
        "Paid features, subscriptions, and one-time purchases may be handled by app stores or payment providers. Billing, cancellation, renewal, and refund rules may depend on the provider used for the purchase.",
        "Feature availability may vary by build, account status, region, provider availability, and service configuration.",
      ],
    },
    {
      heading: "Acceptable Use",
      items: [
        "Do not misuse the app, interfere with service operation, or attempt unauthorized access.",
        "Do not submit unlawful, harmful, misleading, or infringing content.",
        "Do not scrape, copy, resell, or reverse engineer app data or service functionality except where allowed by law.",
        "Do not use CarScanr to make automated decisions about someone else without appropriate review and permission.",
      ],
    },
    {
      heading: "Third-Party Services",
      paragraphs: [
        "CarScanr may rely on third-party services for authentication, hosting, vehicle data, image analysis, listings, purchases, and support. Third-party services may be subject to their own terms and policies.",
      ],
    },
    {
      heading: "Service Changes",
      paragraphs: [
        "We may update, suspend, limit, or discontinue parts of the app or service at any time. We may also update these terms as the product changes.",
      ],
    },
    {
      heading: "Disclaimers",
      paragraphs: [
        "CarScanr is provided as available and as is. To the fullest extent permitted by law, we disclaim warranties of accuracy, reliability, availability, fitness for a particular purpose, and non-infringement.",
      ],
    },
    {
      heading: "Limitation of Liability",
      paragraphs: [
        "To the fullest extent permitted by law, CarScanr will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost data, lost value, or business interruption arising from use of the app.",
      ],
    },
    {
      heading: "Termination",
      paragraphs: [
        "We may suspend or terminate access if we believe these terms were violated, if continued access creates risk, or if required by law. You may stop using CarScanr at any time.",
      ],
    },
    {
      heading: "Contact",
      paragraphs: ["Questions about these Terms of Service can be sent to support@carscanr.com."],
    },
  ],
};
