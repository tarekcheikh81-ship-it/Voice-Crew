"""Runs the real server (the page, shim.js, /api/sample, the Samsara lookup) with a fake Samsara and a stand-in agent that
reads the Live Samsara block it is handed. Port 8014. For testing only."""
import json, os, re, sys
from datetime import datetime, timedelta, timezone
K = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'kit', 'voice-crew-team') + os.sep
os.environ.pop('CREW_KEY', None)
os.environ['STATE_FILE'] = __import__('tempfile').gettempdir() + '/e2e_state.json'
os.environ['ACTIVITY_FILE'] = __import__('tempfile').gettempdir() + '/e2e_activity.jsonl'
os.environ['GRANTS_FILE'] = __import__('tempfile').gettempdir() + '/e2e_grants.json'
for f in ('e2e_state.json', 'e2e_activity.jsonl', 'e2e_grants.json'):
    try: os.remove(__import__('tempfile').gettempdir() + '/' + f)
    except OSError: pass
sys.path.insert(0, K + 'server')
import app as crew
import samsara as sm
import uvicorn

recent = lambda h: (datetime.now(timezone.utc) - timedelta(hours=h)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
SEEN = {'urls': []}

def get(url, token):
    SEEN['urls'].append(url.split('?')[0])
    assert token == 'tok-river', 'token for the wrong company'
    if '/fleet/vehicles' in url:
        return {'data': [{'id': '12', 'name': '88113'}], 'pagination': {'endCursor': '', 'hasNextPage': False}}
    return {'data': [
        {'id': 'a', 'startMs': recent(5), 'behaviorLabels': [{'label': 'Speeding'}], 'driver': {'name': 'Ali Hassan'}, 'maxAccelerationGForce': 0.2,
         'speedingMetadata': {'maxSpeedKilometersPerHour': 119, 'postedSpeedLimitKilometersPerHour': 105}, 'location': {'address': {'city': 'Memphis', 'state': 'TN'}}},
        {'id': 'b', 'startMs': recent(2), 'behaviorLabels': [{'label': 'HarshBrake'}], 'driver': {'name': 'Ali Hassan'}, 'maxAccelerationGForce': 0.45, 'location': {}}],
        'pagination': {'endCursor': '', 'hasNextPage': False}}

class Echo:
    mode = 'mock'
    def configured(self): return {k: True for k in crew.TEAM}
    def ask(self, key, prompt):
        m = re.search(r'Safety events: (\d+) in total', prompt)
        if '"intro"' in prompt:
            if m:
                rows = [l for l in prompt.splitlines() if re.match(r'\d+\. ', l)]
                return json.dumps({'intro': 'Truck 88113 had %s safety events today.' % m.group(1), 'details': '\n'.join(rows), 'picks': [], 'noted': [], 'answered': []})
            return json.dumps({'intro': 'Nothing from Samsara in that message.', 'picks': [], 'noted': [], 'answered': []})
        return json.dumps({'says': 'ok', 'details': None, 'code': None, 'handoff': None, 'noted': [], 'answered': []})

crew.backend = Echo()
crew.fleet = sm.Samsara(tokens={'ABBAS': 'tok-abbas-never-used', 'RIVER FREIGHT': 'tok-river'}, get=lambda u, t: (get(u, t) if t == 'tok-river' else {'data': [], 'pagination': {}}))
uvicorn.run(crew.app, host='127.0.0.1', port=8014, log_level='warning')
