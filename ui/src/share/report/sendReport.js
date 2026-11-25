import { downloadExport } from '../geek/exportLog';
import { reportFileName } from './buildReport';

export const REPORTS_URL = '/api/reports';

/** Why a send failed, in words for the person. */
export function sendErrorText(status) {
    if (status === 429) return 'You sent many reports. Try again in one hour, or save the report as a file.';
    if (status === 413) return 'The report is too big for the server. Save it as a file and send it another way.';
    return 'The server did not get the report. Save it as a file and send it another way.';
}

/**
 * Post the report. Sent as text, not JSON: the server's JSON parser stops
 * at 100 kB, and a report can be bigger.
 * @returns {Promise<{ id: string }>}
 */
export async function sendReport(report, { fetchImpl = fetch } = {}) {
    let response;
    try {
        response = await fetchImpl(REPORTS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: JSON.stringify(report),
        });
    } catch (err) {
        const error = new Error(sendErrorText(0));
        error.cause = err;
        error.status = 0;
        throw error;
    }
    if (!response.ok) {
        const error = new Error(sendErrorText(response.status));
        error.status = response.status;
        throw error;
    }
    const body = await response.json().catch(() => ({}));
    if (!body?.id) {
        const error = new Error(sendErrorText(response.status));
        error.status = response.status;
        throw error;
    }
    return { id: String(body.id) };
}

/** The same report as a file, for email or a chat. Returns the file name. */
export function saveReport(report, doc = document) {
    return downloadExport(report, doc, reportFileName(report));
}
