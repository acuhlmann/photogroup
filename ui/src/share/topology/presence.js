/**
 * Who in the room can still send a photo. A peer is `away` once its page
 * went to the background (another app, a locked screen): it is kept in the
 * room for a while, but a phone in that state is usually frozen and can't
 * send anything until it comes back.
 */

export function isAway(peer) {
    return !!peer?.away;
}

/** Room members other than me that hold the whole photo. */
export function holdersOf(photo, peers, myPeerId) {
    const items = Array.isArray(peers) ? peers : (peers?.items || []);
    return (photo?.owners || [])
        .filter(owner => owner.peerId !== myPeerId && !owner.loading)
        .map(owner => items.find(peer => peer.peerId === owner.peerId))
        .filter(Boolean);
}

/** Holders that are in front right now, so P2P can still reach them. */
export function activeHolders(photo, peers, myPeerId) {
    return holdersOf(photo, peers, myPeerId).filter(peer => !isAway(peer));
}

export function peerLabel(peer) {
    return peer?.name || peer?.device || peer?.originPlatform || 'someone';
}
