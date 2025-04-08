export default function Button({ icon, children, onClick, className }) {
  return (
    <button
      className={`bg-gray-800 dark:bg-gray-900 text-white rounded-full p-4 flex items-center gap-1 hover:opacity-90 ${className}`}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}
