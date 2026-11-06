## Bugs pendentes — test-fase4 seção 6 (avaliação/médias)

Encontrados durante validação da Fase E (cancelamento), mas NÃO relacionados às mudanças de cancelamento. Ambos falham com e sem o diff da Fase E.

### Bug 1 — `duas avaliacoes registradas (uma por parte)` — pré-existente

**Teste:** test-fase4.ps1 seção 6
**Assert:** `(@((Get-Json).hiring.evaluations).Count -eq 2)`
**Contexto:** Ana POST /evaluations (rating 5) → 201; Empresa POST /evaluations (rating 4) → 201. Ambos retornam 201, mas `GET /hirings/{id}.evaluations` não retorna 2.
**Causa provável:** o endpoint `GET /hirings/{id}` pode não estar retornando `evaluations` corretamente, OU o teste está com expectativa errada (avaliações cegas: a primeira fica `releasedAt=null` até a segunda ser liberada — o teste pode estar lendo antes da liberação).
**Status:** falhou com e sem Fase E. Não é regressão da Fase E.
**Próxima ação:** investigar em sessão dedicada — capturar o shape real de `GET /hirings/{id}` e o momento da liberação cega.

### Bug 2 — `medias de estrelas atualizadas nos perfis (4 e 5)` — flutuante

**Teste:** test-fase4.ps1 seção 6
**Assert:** `ratings.prof -eq 4 -and ratings.contr -eq 5`
**Contexto:** após Ana e Empresa avaliarem, `ProfessionalProfile.ratingAverage` e `ContractorProfile.ratingAverage` deveriam ser atualizados. Falhou em 2 runs com Fase E, passou em 1 run sem Fase E.
**Causa provável:** timing — `recalculateRating` pode rodar numa transação que não commitou antes do teste ler. OU bug real em `recalculateRating` quando ambas as avaliações chegam em sequência muito rápida.
**Status:** não tem nexo causal com o diff da Fase E (que não toca em `createEvaluation`/`recalculateRating`). Suspeita de flutuação.
**Próxima ação:** investigar em sessão dedicada — capturar valores reais (o teste não imprime) e reproduzir com timing controlado.
