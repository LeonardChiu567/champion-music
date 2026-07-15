export default function KofiLink({ className = '' }) {
  return (
    <a
      href="https://ko-fi.com/lencc"
      target="_blank"
      rel="noreferrer"
      className={`kofi-link ${className}`}
    >
      ☕ Support
    </a>
  );
}
