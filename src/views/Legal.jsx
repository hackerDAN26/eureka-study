import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { Icon } from '../components/ui';
import { CONTACT_EMAIL, PLANS, YEARLY_DISCOUNT, money, price } from '../lib/plans';
import { LOYALTY, TIERS } from '../lib/promos';

const UPDATED = '5 November 2026';
const pctYearly = Math.round(YEARLY_DISCOUNT * 100);
const Mail = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

function Terms() {
  const pro = PLANS.pro;
  const max = PLANS.max;
  return (
    <>
      <h1>Terms &amp; Conditions</h1>
      <p className="legal__updated">Last updated {UPDATED}</p>
      <p>
        These terms govern your use of EUREKA, a study workspace with an AI tutor (“EUREKA”, “we”, “us”). By creating an account or using
        EUREKA you agree to them. If you don’t agree, please don’t use EUREKA.
      </p>

      <h2>1. Who can use EUREKA</h2>
      <p>
        You must be at least 13 years old. If you are under 18, or under the age of digital consent where you live, you need permission from a
        parent or guardian, who accepts these terms on your behalf. Schools that give EUREKA to students are responsible for obtaining any
        consent their students need.
      </p>

      <h2>2. Your account</h2>
      <p>
        You sign in with your Google account. Keep that account secure; you are responsible for activity under your EUREKA account. Tell us
        straight away at <Mail /> if you think someone else has used it.
      </p>

      <h2>3. Plans, payment and cancellation</h2>
      <p>
        EUREKA offers a Free plan and paid plans: Pro at {money(pro.monthly)} a month or {money(price(pro, 'yearly').total)} a year, and Max at{' '}
        {money(max.monthly)} a month or {money(price(max, 'yearly').total)} a year (prices in USD; yearly plans are {pctYearly}% off the monthly price).
        Taxes may be added where required. Paid plans renew automatically at the end of each billing period until you cancel. You can cancel
        at any time and keep your paid features until the end of the period you have paid for. Except where the law requires otherwise,
        payments are non-refundable, but contact us if something has gone wrong and we will look at it fairly. We may change prices with at
        least 30 days’ notice; changes apply from your next renewal.
      </p>
      <p>
        Each plan includes the allowances shown on the plans page (for example AI messages per day and sources per message). Allowances
        described as “fair use” may be limited if use is automated, shared between people, or harms the service for others.
      </p>
      <p>
        Paid plans are sold through Whop and switched on with the license key from your Whop purchase. Your license key is for you
        personally; sharing it, or trying to unlock a plan without paying, may lead to the key being revoked. We check your membership with
        Whop regularly, so a cancelled or failed subscription returns to the Free plan at the end of the paid period.
      </p>

      <h2>3a. Sales, offers, rewards and loyalty</h2>
      <p>
        From time to time we run limited-time sales (for example Back to School, Midterm, Black Friday, Winter Holiday, Exam Season and Summer),
        a welcome offer for new students, an Exam Year discount, and limited-time bonuses such as extra daily AI messages. Unless an offer says
        otherwise: only one discount applies per purchase (we apply the best one you qualify for), it applies to your first billing period
        (first month or first year), and later periods renew at the standard price less any loyalty discount. Offers can’t be exchanged for
        cash or applied to past payments, and dates, amounts and bonuses may change.
      </p>
      <p>
        <strong>Rewards.</strong> You earn Leaves for studying with EUREKA. Leaves unlock reward tiers ({TIERS.map(t => t.name).join(', ')}) with
        perks such as extra daily messages and plan discounts. Leaves have no cash value, can’t be transferred, and may be removed if earned
        through automation, abuse or anything that breaks these terms.
      </p>
      <p>
        <strong>Loyalty.</strong> While you stay continuously subscribed to Pro or Max, renewals get cheaper:{' '}
        {LOYALTY.map(l => `${l.percent}% off after ${l.months} months (${l.name})`).join(', ')}. Cancelling or moving to Free resets your loyalty
        level.
      </p>
      <p>
        Discounts claimed by self-declaration (such as the Exam Year discount) are for eligible students only; we may ask for reasonable proof.
      </p>

      <h2>4. Academic integrity</h2>
      <p>
        EUREKA is built to help you learn, not to do your work for you. You are responsible for following your school’s, exam board’s and
        university’s rules on AI tools, collaboration and plagiarism. Don’t submit AI-generated content as your own where that isn’t allowed.
      </p>

      <h2>5. Your content</h2>
      <p>
        You keep ownership of the notes, files, chats and deadlines you add (“your content”). You give us permission to store, process and
        transmit your content only as needed to run EUREKA for you — including sending prompts and attached files to our AI provider to
        generate answers. Only upload material you have the right to use. When you share a workspace, the people you invite receive a copy of
        its content.
      </p>

      <h2>6. AI answers</h2>
      <p>
        EUREKA’s tutor is powered by open AI models (OpenAI GPT-OSS and Alibaba Qwen) running on Groq. AI answers can be incomplete or wrong. Check important facts against your
        specification, textbooks and teachers. EUREKA is not a substitute for professional, medical, legal or financial advice.
      </p>

      <h2>7. Acceptable use</h2>
      <p>
        Don’t use EUREKA to break the law; harass or harm others; upload malware; infringe anyone’s intellectual property; try to get around
        plan limits or security; scrape or resell the service; or generate content that is sexual involving minors, hateful or violent.
      </p>

      <h2>8. Third-party services</h2>
      <p>
        EUREKA relies on services such as Google Sign-In, the Groq API and Whop (payments). Your use of those parts is also subject
        to their terms. We aren’t responsible for third-party services we don’t control.
      </p>

      <h2>9. Suspension and ending</h2>
      <p>
        You can stop using EUREKA and delete your data at any time (see the Privacy Policy). We may suspend or close accounts that seriously or
        repeatedly break these terms. If we discontinue EUREKA we will give reasonable notice and refund any unused prepaid period.
      </p>

      <h2>10. Liability</h2>
      <p>
        EUREKA is provided “as is”. To the extent the law allows, we aren’t liable for indirect or consequential losses, lost data you didn’t
        back up, or exam results, and our total liability to you is limited to the amount you paid us in the 12 months before the claim.
        Nothing in these terms limits rights you have under consumer law that can’t be excluded.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update these terms. If a change is significant we will tell you in the app or by email before it takes effect. Continuing to use
        EUREKA after that means you accept the new terms.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these terms: <Mail />.
      </p>
    </>
  );
}

function Privacy({ onDeleteAll }) {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="legal__updated">Last updated {UPDATED}</p>
      <p>This policy explains what EUREKA collects, why, and the choices you have. We collect as little as we can to run the service.</p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details from Google</strong> when you sign in: your name, email address, profile picture and Google account ID.
        </li>
        <li>
          <strong>Your study content</strong>: workspaces, conversations, subjects, deadlines, saved prompts and settings.
        </li>
        <li>
          <strong>Files you attach</strong> to a chat, which are read so the tutor can answer questions about them.
        </li>
        <li>
          <strong>Usage counts</strong>, such as how many AI messages and web searches you’ve used today, to apply plan allowances.
        </li>
        <li>
          <strong>Billing details</strong> are collected and processed by our payment provider. We receive confirmation of your plan, not your
          full card number.
        </li>
        <li>
          <strong>Messages you send us</strong> by email.
        </li>
      </ul>

      <h2>Where it’s stored</h2>
      <p>
        In this version of EUREKA your workspaces, chats, deadlines, revision plan, topic ratings, grades, marks and settings are stored in your browser’s local storage on your own device.
        They are not uploaded to EUREKA servers. Clearing your browser data, or using the button below, removes them.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>To provide the tutor, calendar, reminders and sharing features you use.</li>
        <li>To apply your plan’s allowances and manage your subscription.</li>
        <li>To reply to you and keep EUREKA secure.</li>
      </ul>
      <p>We don’t sell your personal information and we don’t use your content for advertising.</p>

      <h2>Who we share it with</h2>
      <ul>
        <li>
          <strong>Groq (AI API)</strong> receives your prompts, attached files and the context needed to answer (such as your
          subjects, grades, topic ratings and upcoming deadlines) to generate responses. Web searches are carried out by Groq’s
          browser search tool (powered by Exa).
        </li>
        <li>
          <strong>Google Sign-In</strong> confirms who you are when you sign in.
        </li>
        <li>
          <strong>Our payment provider</strong> processes subscription payments.
        </li>
        <li>
          <strong>People you invite</strong> receive a copy of the workspace you share with them.
        </li>
        <li>Authorities, if the law requires it.</li>
      </ul>

      <h2>Notifications</h2>
      <p>
        Deadline reminders are calculated on your device. Browser notifications are only shown if you allow them, and only while EUREKA is open.
        If you export deadlines to your calendar app, that app handles those reminders.
      </p>

      <h2>Students and children</h2>
      <p>
        EUREKA is for users aged 13 and over. If you are under 18 a parent or guardian should agree to your use. If you believe a child has
        given us personal information without the right consent, contact us and we will delete it.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live, you can ask to access, correct, export or delete your personal information, or object to how it’s used.
        You can export any workspace from Share workspace, and delete everything EUREKA stores in this browser here:
      </p>
      <button type="button" className="btn btn--danger" onClick={onDeleteAll}>
        Delete all my EUREKA data from this browser
      </button>
      <p>
        For anything else, email <Mail />. We’ll respond within 30 days.
      </p>

      <h2>Security and retention</h2>
      <p>
        Connections to Google use HTTPS. Data in your browser stays until you delete it. Data held by our providers is kept only as long as they
        need it to provide their service or as the law requires.
      </p>

      <h2>Changes</h2>
      <p>We’ll post any changes here and update the date above; significant changes will be announced in the app.</p>

      <h2>Contact</h2>
      <p>
        EUREKA · <Mail />
      </p>
    </>
  );
}

export default function Legal({ page, onDeleteAll }) {
  return (
    <div className="legal">
      <a className="legal__back" href="#/chat">
        <Icon icon={ArrowLeft01Icon} size={14} /> Back to EUREKA
      </a>
      <nav className="legal__tabs">
        <a href="#/terms" aria-current={page === 'terms' ? 'page' : undefined}>
          Terms &amp; Conditions
        </a>
        <a href="#/privacy" aria-current={page === 'privacy' ? 'page' : undefined}>
          Privacy Policy
        </a>
      </nav>
      <article className="legal__doc prose">{page === 'terms' ? <Terms /> : <Privacy onDeleteAll={onDeleteAll} />}</article>
    </div>
  );
}
