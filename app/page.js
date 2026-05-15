// app/page.js
// Next.js sert automatiquement les fichiers dans public/ à leur URL.
// index.html dans public/ est accessible à /index.html.
// Cette page redirige silencieusement vers ce fichier statique.
import { redirect } from "next/navigation";

export default function Page() {
  redirect("/index.html");
}
