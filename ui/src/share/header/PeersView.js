import React, {Component} from 'react';
import PropTypes from 'prop-types';

import Badge from '@material-ui/core/Badge';
import PeopleRounded from '@material-ui/icons/PeopleRounded';
import PeopleOutline from '@material-ui/icons/PeopleOutline';
import IconButton from "@material-ui/core/IconButton/IconButton";
import Dialog from "@material-ui/core/Dialog/Dialog";
import DialogContent from "@material-ui/core/DialogContent/DialogContent";
import DialogActions from "@material-ui/core/DialogActions/DialogActions";
import Button from "@material-ui/core/Button/Button";
import Slide from '@material-ui/core/Slide';

function Transition(props) {
    return <Slide direction="down" {...props} />;
}

export default class PeersView extends Component {

    constructor(props) {
        super(props);

        this.state = {
            numPeers: -1,
            sseConnections: -1,
            ips: [],
            open: false
        };

        const { emitter } = props;
        emitter.on('numPeers', value => {
            this.setState({numPeers: value})
        });
        emitter.on('sseConnections', (value, ips) => {
            this.setState({
                sseConnections: value,
                ips: ips
            })
        });
    }

    show(open) {
        this.setState({
            open: open
        });
    }

    render() {
        const { ips } = this.state;
        const content = ips.map((node, index) => {

            return <div key={index}>
                    {
                        node.map((ip, index) => {
                            let divider = index < node.length -1 ? ' << ' : '';
                            return <span key={index}>{ip}{divider}</span>
                        })
                    }
                    </div>
                })

        return (
            <div>
                <div>
                    <IconButton
                        onClick={this.show.bind(this, true)}>
                        <Badge badgeContent={this.state.numPeers} color="primary" >
                            <PeopleRounded />
                        </Badge>
                    </IconButton>
                </div>
                <div>
                    <IconButton
                        onClick={this.show.bind(this, true)}>
                        <Badge badgeContent={this.state.sseConnections} color="secondary">
                            <PeopleOutline />
                        </Badge>
                    </IconButton>
                </div>

                <Dialog
                    open={this.state.open}
                    onClose={this.show.bind(this, false)}
                    aria-labelledby="alert-dialog-title"
                    aria-describedby="alert-dialog-description"
                    TransitionComponent={Transition}
                    keepMounted>
                    <DialogContent>
                        {content}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={this.show.bind(this, false)} color="primary">
                            Close
                        </Button>
                    </DialogActions>
                </Dialog>
            </div>
        );
    }
}

PeersView.propTypes = {
    emitter: PropTypes.object.isRequired,
};