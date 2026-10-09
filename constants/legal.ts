/**
 * constants/legal.ts — Terms of Use and Privacy Policy shown in the app.
 *
 * Plain data on purpose: the screen (app/legal.tsx) just renders it, and the
 * wording lives in one place. Every statement below describes what indorse
 * does TODAY. If a data flow or feature changes, change the text here, bump
 * LEGAL_VERSION and LEGAL_UPDATED, and keep api/_lib/knowledge.ts in step.
 *
 * CONTACT_EMAIL still ships as a visible placeholder on purpose — it is
 * printed in three places a user is told to write to, so shipping a real
 * mailbox is a release-blocking edit rather than something to forget.
 */

export const LEGAL_VERSION = '1.0'
export const LEGAL_UPDATED = '9 October 2026'

/** The person or company that runs indorse. */
export const OPERATOR_NAME = 'indorse'
/** REPLACE before release: a mailbox you actually read. */
export const CONTACT_EMAIL = 'REPLACE: contact@yourdomain'
/** Confirmed: matches the Nigeria Data Protection Act 2023 named in PRIVACY. */
export const GOVERNING_LAW = 'the Federal Republic of Nigeria'

export interface LegalSection {
  id: string
  title: string
  body: string[]
}

export interface LegalDoc {
  title: string
  intro: string
  sections: LegalSection[]
}

export const TERMS: LegalDoc = {
  title: 'Terms of Use',
  intro: `These terms are an agreement between you and ${OPERATOR_NAME} ("we", "us") about your use of the indorse app and its servers. Please read them. By creating a passcode, connecting a wallet or otherwise using indorse, you agree to them. If you do not agree, do not use the app.`,
  sections: [
    {
      id: 't1',
      title: '1. What indorse is',
      body: [
        'indorse is a Solana app for smallholder farmers. It lets you diagnose crops from photos, keep a farm record on a blockchain, log harvest batches, lock USDC in escrow against a batch, and underwrite a rainfall-based weather cover.',
        'indorse explains how it works but never moves money for you. Every transaction is signed by you, in your own wallet.',
      ],
    },
    {
      id: 't2',
      title: '2. Beta software and test networks',
      body: [
        'indorse is early software. It may run on a Solana test network (devnet) where tokens have no real-world value, and features may change, break or be removed without notice.',
        'If you switch the app to a network that uses real funds, you do so at your own risk and you are responsible for checking what you are signing.',
      ],
    },
    {
      id: 't3',
      title: '3. Your wallet and your keys',
      body: [
        'You need a Solana wallet to use most features. Your keys and seed phrase stay in your wallet app. We never ask for them and cannot recover them, reverse a transaction or restore lost funds.',
        'You are responsible for your wallet, your passcode and any device you use with indorse. Blockchain transactions are final.',
      ],
    },
    {
      id: 't4',
      title: '4. Eligibility and access',
      body: [
        'You must be at least 18 years old and able to enter a binding agreement to use indorse.',
        'Some features check your wallet against an allowlist or look for a Seeker Genesis Token. We may grant, change or withdraw access, and a Seeker device may unlock higher cover limits.',
      ],
    },
    {
      id: 't5',
      title: '5. Your content and what you report',
      body: [
        "Photos, farm details, GPS coordinates, scout reports and harvest batches that you submit must be genuine and accurate. You must not fake locations, reuse other people's photos, or submit false reports to earn rewards or influence a grade or an escrow.",
        'Scout reports and harvest batches are written to a public blockchain. Once written they cannot be edited or deleted by us or by you. See the Privacy Policy for what this means for your location.',
      ],
    },
    {
      id: 't6',
      title: '6. AI results are not professional advice',
      body: [
        'Crop diagnoses and harvest grades are produced by AI models and can be wrong. Treat them as a starting point, not as a replacement for an agronomist, extension officer or laboratory test.',
        'We do not guarantee that any diagnosis or grade is correct, complete or suitable for a purchase, sale or treatment decision.',
      ],
    },
    {
      id: 't7',
      title: '7. Weather cover',
      body: [
        'Weather cover is an experimental, rule-based feature. It pays a fixed amount when the season rainfall reported by the on-chain oracle ends strictly below the trigger you chose, and pays nothing at or above it. It does not assess damage or loss.',
        'It is not offered by a licensed insurer and may not be treated as insurance under the law where you live. Rainfall figures come from oracle readings, which can be late, provisional or wrong. We do not promise any payout.',
        'Premiums, cover limits and refund rules are set by the on-chain program and shown in the app before you sign. Read them before you underwrite.',
      ],
    },
    {
      id: 't8',
      title: '8. Escrow and rewards',
      body: [
        'Escrow locks USDC against a harvest batch under the rules of the on-chain program. The buyer can cancel and reclaim funds before the lock expires; after that the release path applies. We do not hold your funds and cannot release or return them for you.',
        "Scout rewards are a single fixed amount set in the program, paid from a shared reward vault to the wallet that made a verified report. Verifiers decide a report's status but do not control payment. We do not promise that rewards will be available.",
      ],
    },
    {
      id: 't9',
      title: '9. Acceptable use',
      body: [
        'Do not misuse indorse. In particular, do not: attack, overload or probe our servers; bypass rate limits or the allowlist; submit unlawful, harmful or deceptive content; interfere with oracles or verifiers; or use the app to break the law.',
        'We may limit or block access for anyone who does.',
      ],
    },
    {
      id: 't10',
      title: '10. Third-party services',
      body: [
        'indorse relies on services we do not control, including Solana and its wallets, RPC providers, AI model providers, email delivery and hosting. They have their own terms, and we are not responsible for their outages, errors or changes.',
      ],
    },
    {
      id: 't11',
      title: '11. No warranty',
      body: [
        'indorse is provided "as is" and "as available", without warranties of any kind, to the fullest extent the law allows. We do not promise that it will be uninterrupted, error-free or secure.',
      ],
    },
    {
      id: 't12',
      title: '12. Limit of liability',
      body: [
        'To the fullest extent the law allows, we are not liable for indirect or consequential loss, lost profit, lost crops, lost tokens, or loss caused by wallet compromise, blockchain finality, oracle error, AI error or third-party failure.',
        'Nothing in these terms limits liability that cannot be limited by law.',
      ],
    },
    {
      id: 't13',
      title: '13. Changes and ending',
      body: [
        'We may update these terms. The version and date are shown at the top of this screen, and continued use after a change means you accept it. You can stop using indorse at any time and erase local data from Settings. Records already written to the blockchain stay there.',
      ],
    },
    {
      id: 't14',
      title: '14. Governing law and contact',
      body: [
        `These terms are governed by the laws of ${GOVERNING_LAW}. Questions about them can be sent to ${CONTACT_EMAIL}.`,
      ],
    },
  ],
}

export const PRIVACY: LegalDoc = {
  title: 'Privacy Policy',
  intro: `This policy explains what personal data indorse handles, why, who receives it and what choices you have. ${OPERATOR_NAME} is the controller of the data handled by the indorse servers. We aim to follow the Nigeria Data Protection Act 2023 and similar laws that apply to you.`,
  sections: [
    {
      id: 'p1',
      title: '1. What we handle',
      body: [
        'Wallet address and signatures: when you connect a wallet and verify your device, we receive your public wallet address and a signed sign-in message. We never receive your keys or seed phrase.',
        'Farm and field data: farm name, latitude and longitude, acres, crop, quantity, notes, scout reports, harvest batches, escrow and cover details that you enter.',
        'Photos: up to 5 crop photos per scouting analysis, and evidence photos for harvest batches.',
        'Location: your device location only if you tap Use my location or allow location access, and only to fill in coordinates.',
        'Email address: only if you choose to verify an email for passcode recovery.',
        'Device and technical data: your passcode settings and preferences (kept on your device), and standard server logs such as IP address, time and request type.',
      ],
    },
    {
      id: 'p2',
      title: '2. Why we use it',
      body: [
        'To run the features you ask for: diagnose crops, grade harvests, record farms and reports, show the weather cover, and verify your device and Seeker status.',
        'To keep the service safe: rate limiting, abuse prevention and fixing faults.',
        'To send a verification code and recover your passcode, if you add an email. We do not use your email for marketing or notifications.',
        'We do not sell your personal data, and we do not use it for advertising.',
      ],
    },
    {
      id: 'p3',
      title: '3. Public blockchain data',
      body: [
        'Scout reports and harvest batches write your field GPS coordinates, the result and related details to the Solana blockchain. Blockchain data is public: anyone can read it, copy it and link it to your wallet address. It cannot be changed or deleted by us or by you.',
        'Think carefully before submitting a report or batch from a location you do not want others to see.',
      ],
    },
    {
      id: 'p4',
      title: '4. Who else receives data',
      body: [
        'AI providers: to analyse photos and grade harvests, our server sends the photos or batch details to AI model providers (Google for Gemini, Groq and OpenAI). They process the data to return a result and apply their own policies.',
        'Email delivery: if you verify an email, the address and code pass through our email provider (Resend).',
        'Hosting and network: our API runs on Vercel, and we use Solana RPC providers to read the blockchain and check for a Seeker Genesis Token.',
        'Your wallet app and the blockchain, as described above. We may also disclose data if the law requires it.',
      ],
    },
    {
      id: 'p5',
      title: '5. What stays on your device',
      body: [
        'Your passcode, language, theme, security settings and a local copy of your farm data are stored on your device. Without a connected wallet, a farm is saved on the device only. Erase local data in Settings, Account & Local Data removes this local data and does not touch the blockchain.',
      ],
    },
    {
      id: 'p6',
      title: '6. How long we keep it',
      body: [
        'Server logs and verification codes are kept only as long as needed to run and protect the service; verification codes expire after 10 minutes. Data sent to AI providers is covered by their retention rules. Blockchain records are permanent.',
      ],
    },
    {
      id: 'p7',
      title: '7. Your choices and rights',
      body: [
        `You can ask us to tell you what data we hold about you, correct it, delete what we are able to delete, or stop using it, by writing to ${CONTACT_EMAIL}. You can withdraw consent at any time by stopping use of the app and erasing local data.`,
        'We cannot delete blockchain records. If you are not satisfied with how we handle your data, you may complain to the Nigeria Data Protection Commission or the authority where you live.',
        'You can turn off camera, location and notification permissions in your device settings. Some features will then stop working.',
      ],
    },
    {
      id: 'p8',
      title: '8. Security',
      body: [
        'Connections to our servers are encrypted. Signing happens in your wallet, and admin actions are signed fresh each time. No system is perfectly secure, so we cannot promise absolute security.',
      ],
    },
    {
      id: 'p9',
      title: '9. Children',
      body: [
        'indorse is for adults aged 18 and over. We do not knowingly collect data from children. If you believe a child has used the app, contact us and we will act on it where we can.',
      ],
    },
    {
      id: 'p10',
      title: '10. Changes and contact',
      body: [
        `We will update this policy when our data handling changes. The version and date are shown at the top of this screen. Questions: ${CONTACT_EMAIL}.`,
      ],
    },
  ],
}
