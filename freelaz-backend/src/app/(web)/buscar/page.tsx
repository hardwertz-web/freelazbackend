import { redirect } from "next/navigation";

/**
 * A busca não é uma tela própria: ela vive na Home. A tab "Buscar" cai aqui e
 * é redirecionada para a Home com ?focus=search, que foca o campo.
 */
export default function BuscarPage() {
  redirect("/?focus=search");
}
