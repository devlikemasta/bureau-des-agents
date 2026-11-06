// En cadre vertical (pour filmer un reel), sous le bureau : le plan de Max et la rangée de l'équipe,
// lisibles en grand sur un téléphone.
import { useShallow } from 'zustand/react/shallow';
import { ROLES } from '../../shared/activity.ts';
import { teamList, useOffice } from '../state/store.ts';
import { Avatar } from './Panel.tsx';

export function Strips() {
  const plan = useOffice((s) => s.plan);
  const team = useOffice(useShallow(teamList));
  const mission = useOffice((s) => s.mission);
  if (!mission) {
    return (
      <div className="strips">
        <div className="legend">
          {(['recherche', 'code', 'design', 'redaction', 'analyse'] as const).map((r) => (
            <span key={r} style={{ ['--c' as string]: ROLES[r].color }}>{ROLES[r].icon} {ROLES[r].label}</span>
          ))}
        </div>
      </div>
    );
  }
  const done = plan.filter((p) => p.status === 'completed').length;
  return (
    <div className="strips">
      {plan.length > 0 && (
        <div className="strip-plan">
          <b>Plan <span>{done}/{plan.length}</span></b>
          <ul>{plan.slice(0, 4).map((p, i) => <li key={i} className={p.status}><i />{p.text}</li>)}</ul>
        </div>
      )}
      {team.length > 0 && (
        <div className="strip-team">
          {team.slice(-12).map((a) => (
            <span key={a.id} className={`mate ${a.status}`} style={{ ['--c' as string]: ROLES[a.role].color }}>
              <Avatar role={a.role} size={18} />
              {a.name}
              {a.status === 'done' ? ' ✓' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
