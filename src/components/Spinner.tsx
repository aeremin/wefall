export default function Spinner({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div className={`flex items-center justify-center ${fullScreen ? 'min-h-screen' : 'py-16'}`}>
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-sky-200 border-t-sky-600" />
    </div>
  );
}
