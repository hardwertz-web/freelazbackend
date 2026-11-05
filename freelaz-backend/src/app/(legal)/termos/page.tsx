import styles from "../legal.module.css";

export const metadata = {
  title: "Termos de Uso — Freelaz",
  description: "Termos de Uso da plataforma Freelaz.",
  robots: { index: true, follow: true },
};

export default function TermosPage() {
  return (
    <article className={styles.article}>
      <div className={styles.warning}>
        ⚠️ <strong>PLACEHOLDER TÉCNICO</strong> — este documento é provisório e sujeito a revisão jurídica antes da operação em produção. Versão 1.0 (04/11/2026).
      </div>

      <h1 className={styles.title}>Termos de Uso</h1>
      <p className={styles.updated}>Última atualização: 04/11/2026 · Versão 1.0</p>

      <h2>1. Identificação da plataforma</h2>
      <p>O Freelaz é uma plataforma de intermediação que conecta profissionais freelancers a empresas e pessoas físicas contratantes. Contato: <a href="mailto:freelaz.conecta@gmail.com">freelaz.conecta@gmail.com</a>.</p>

      <h2>2. Definições</h2>
      <ul>
        <li><strong>Plataforma:</strong> o site e o aplicativo Freelaz.</li>
        <li><strong>Profissional:</strong> usuário que oferece serviços.</li>
        <li><strong>Contratante:</strong> usuário que contrata serviços.</li>
        <li><strong>Contratação:</strong> vínculo firmado entre Profissional e Contratante.</li>
        <li><strong>Retenção:</strong> valor pago pelo Contratante e mantido pela Plataforma até a conclusão do serviço.</li>
        <li><strong>Repasse:</strong> transferência do valor retido ao Profissional após a conclusão.</li>
      </ul>

      <h2>3. Cadastro e elegibilidade</h2>
      <p>O cadastro é gratuito e requer CPF ou CNPJ válido, e-mail, telefone e senha. É vedado o cadastro de menores de 18 anos. O usuário é responsável pela veracidade das informações fornecidas.</p>

      <h2>4. Papéis</h2>
      <p>A mesma conta pode ativar os papéis de Profissional e de Contratante. A ativação do papel Profissional exige verificação de identidade (documento com foto e selfie). A ativação do papel Contratante exige verificação leve (e-mail/telefone).</p>

      <h2>5. Publicação de vagas</h2>
      <p>A publicação de vagas freelance é gratuita. A publicação de vagas CLT exige assinatura ativa da Plataforma. A Plataforma cobra comissão sobre contratações freelance concluídas, conforme tabela vigente.</p>

      <h2>6. Contratação, pagamento e retenção</h2>
      <p>O pagamento é feito pelo Contratante via Pix, por meio do gateway Asaas. O valor fica retido pela Plataforma até a conclusão do serviço, comprovada por código de fechamento de turno. O repasse ao Profissional ocorre após a conclusão, conforme o fluxo estabelecido.</p>

      <h2>7. Obrigações do Profissional</h2>
      <p>O Profissional se compromete a comparecer ao serviço no dia e horário combinados, a fornecer o código de abertura ao iniciar o turno e a manter conduta profissional durante toda a prestação.</p>

      <h2>8. Obrigações do Contratante</h2>
      <p>O Contratante se compromete a efetuar o pagamento no prazo, a confirmar a abertura e o fechamento do turno com os códigos fornecidos, e a avaliar o Profissional após a conclusão.</p>

      <h2>9. Proibições</h2>
      <ul>
        <li>Contato ou pagamento fora da Plataforma.</li>
        <li>Fraude, assédio, discriminação ou qualquer conduta abusiva.</li>
        <li>Uso de informações de outros usuários para fins não relacionados à contratação.</li>
      </ul>

      <h2>10. Propriedade intelectual, limitação e foro</h2>
      <p>A marca, o software e o conteúdo da Plataforma são de propriedade do Freelaz. A Plataforma não se responsabiliza pela execução do serviço em si, atuando como intermediadora. Eventuais disputas serão resolvidas no foro da comarca de Itajubá/MG.</p>

      <p className={styles.contact}>Dúvidas: <a href="mailto:freelaz.conecta@gmail.com">freelaz.conecta@gmail.com</a></p>
    </article>
  );
}
