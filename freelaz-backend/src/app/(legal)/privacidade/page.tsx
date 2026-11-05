import styles from "../legal.module.css";

export const metadata = {
  title: "Política de Privacidade — Freelaz",
  description: "Política de Privacidade da plataforma Freelaz (LGPD).",
  robots: { index: true, follow: true },
};

export default function PrivacidadePage() {
  return (
    <article className={styles.article}>
      <div className={styles.warning}>
        ⚠️ <strong>PLACEHOLDER TÉCNICO</strong> — este documento é provisório e sujeito a revisão jurídica antes da operação em produção. Versão 1.0 (04/11/2026).
      </div>

      <h1 className={styles.title}>Política de Privacidade</h1>
      <p className={styles.updated}>Última atualização: 04/11/2026 · Versão 1.0</p>

      <h2>1. Controlador</h2>
      <p>
        O Freelaz é a plataforma responsável pelo tratamento dos dados pessoais coletados no contexto do uso do site e do aplicativo,
        nos termos da Lei Geral de Proteção de Dados (LGPD – Lei nº 13.709/2018). Para assuntos relacionados a privacidade e dados
        pessoais, o contato é: <a href="mailto:freelaz.conecta@gmail.com">freelaz.conecta@gmail.com</a>.
      </p>

      <h2>2. Dados coletados</h2>
      <p>Podemos coletar, conforme o uso da plataforma e o papel do usuário:</p>
      <ul>
        <li><strong>Cadastro e identificação:</strong> nome, nome fantasia/razão social, CPF/CNPJ, data de nascimento (quando aplicável), e-mail, telefone, cidade/estado/região e senha (armazenada de forma protegida).</li>
        <li><strong>Perfil profissional:</strong> categorias, biografia, experiências, portfólio (fotos), disponibilidade, preço de referência e informações de apresentação.</li>
        <li><strong>Verificação e segurança:</strong> documentos e imagens enviados para verificação de identidade, quando aplicável ao papel.</li>
        <li><strong>Contratações e pagamentos:</strong> dados necessários à intermediação, retenção e repasse (incluindo integrações com meios de pagamento, como Pix via Asaas), registros de transações e códigos operacionais de turno.</li>
        <li><strong>Uso e comunicações:</strong> mensagens trocadas na plataforma, avaliações, registros de acesso e informações técnicas (por exemplo, logs) para segurança e funcionamento.</li>
      </ul>

      <h2>3. Finalidade</h2>
      <p>Utilizamos os dados para:</p>
      <ul>
        <li>Criar e gerenciar contas, autenticação e papéis (Profissional/Contratante).</li>
        <li>Viabilizar publicação de vagas, candidaturas, contratações, pagamentos, retenção, repasses e avaliações.</li>
        <li>Realizar verificação de identidade e prevenção a fraudes, abusos e violações dos Termos de Uso.</li>
        <li>Prestar suporte, comunicar atualizações relevantes e cumprir obrigações legais/regulatórias.</li>
        <li>Melhorar a segurança, a confiabilidade e a experiência de uso da plataforma.</li>
      </ul>

      <h2>4. Compartilhamento</h2>
      <p>
        Não vendemos dados pessoais. O compartilhamento pode ocorrer, de forma limitada e quando necessário, com:
      </p>
      <ul>
        <li><strong>Outros usuários:</strong> informações do perfil público/necessárias à contratação (por exemplo, nome, categorias, avaliações e portfólio, conforme as regras de visibilidade da plataforma).</li>
        <li><strong>Fornecedores e parceiros operacionais:</strong> serviços de infraestrutura, hospedagem, armazenamento de arquivos, processamento de pagamentos (ex.: Asaas), envio de comunicações e ferramentas de suporte, sob obrigações contratuais de proteção.</li>
        <li><strong>Autoridades:</strong> quando exigido por lei, ordem judicial ou para proteção de direitos, segurança e prevenção a fraudes.</li>
      </ul>

      <h2>5. Retenção</h2>
      <p>
        Mantemos os dados pelo tempo necessário para cumprir as finalidades descritas, atender obrigações legais/regulatórias,
        resolver disputas e fazer cumprir acordos. Prazos específicos podem variar conforme o tipo de dado (cadastro, transações,
        registros de segurança e comunicações). Após o período aplicável, os dados poderão ser excluídos ou anonimizados, quando viável.
      </p>

      <h2>6. Direitos</h2>
      <p>
        Nos termos da LGPD, você pode solicitar, quando aplicável: confirmação de tratamento, acesso, correção, anonimização,
        portabilidade, eliminação de dados tratados com base em consentimento, informação sobre compartilhamento e revogação de
        consentimento. Para exercer seus direitos, entre em contato pelo e-mail indicado abaixo.
      </p>

      <h2>7. Segurança</h2>
      <p>
        Adotamos medidas técnicas e organizacionais razoáveis para proteger os dados pessoais contra acessos não autorizados,
        perda, alteração ou divulgação indevida. Nenhum sistema é totalmente seguro; recomendamos o uso de senha forte e a proteção
        das suas credenciais.
      </p>

      <h2>8. Contato/DPO</h2>
      <p>
        Para dúvidas, solicitações ou exercício de direitos relacionados a dados pessoais (incluindo contato com o encarregado/DPO,
        conforme aplicável), utilize: <a href="mailto:freelaz.conecta@gmail.com">freelaz.conecta@gmail.com</a>.
      </p>

      <p className={styles.contact}>Dúvidas: <a href="mailto:freelaz.conecta@gmail.com">freelaz.conecta@gmail.com</a></p>
    </article>
  );
}
