// Fallback for any unmatched route.

import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-black">404</h1>
        <h2 className="mt-4 text-xl font-extrabold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          That page does not exist, or the link has moved.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">Go to the patient workspace</Link>
        </Button>
      </div>
    </div>
  );
}
